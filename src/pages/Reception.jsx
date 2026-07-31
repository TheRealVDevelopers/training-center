import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { signInAnonymously } from 'firebase/auth'
import { auth } from '../firebase'
import { CURRENCY, PACK_CREDITS, packPrice } from '../config'
import {
  subscribeMembers,
  subscribeActiveSession,
  subscribeSessionEntries,
  subscribeScanEvents,
  resolveMemberLocal,
  resolveMember,
  ensureActiveSession,
  endSession,
  checkIn,
  markExit,
  addGuest,
  recharge,
  assignCard,
  logScanEvent,
} from '../lib/db'
import { useWakeLock } from '../lib/wakeLock'
import { useCardWedge, captureOneCard } from '../lib/wedge'
import { useLocalReader, sendReaderFeedback, captureNextCard } from '../lib/localReader'
import { normalizeCode } from '../lib/readerId'
import { feedback, primeAudio } from '../lib/feedback'
import ThemeToggle from '../components/ThemeToggle'

// THE staff screen. Tap → GREEN in under a heartbeat (verdict comes from the
// live member list already on this device; the cloud confirms in the
// background). RED pulses = no credits → one tap recharges. The receptionist
// never navigates away: search, recharge and card-assign slide over the board.
//   viewOnly (at /feed): the door-QR public view — watch, nothing else.
export default function Reception({ viewOnly = false }) {
  const [members, setMembers] = useState([])
  const [session, setSession] = useState(null)
  const [entries, setEntries] = useState([])
  const [events, setEvents] = useState([])
  const [localRows, setLocalRows] = useState([]) // optimistic rows, instant
  const [mode, setMode] = useState('in') // 'in' | 'out'
  const [rechargeFor, setRecharge] = useState(null) // member | null
  const [panel, setPanel] = useState(false) // search slide-over
  const [search, setSearch] = useState('')
  const [busyId, setBusyId] = useState('')
  const [ending, setEnding] = useState(false)

  const membersRef = useRef([])
  const sessionRef = useRef(null)
  const entriesRef = useRef([])
  const modeRef = useRef('in')
  const recent = useRef(new Map())
  const catcher = useRef(null)
  const flushTimer = useRef(null)

  useWakeLock(true)
  // Public /feed viewers get a silent identity so the locked rules let them read.
  useEffect(() => {
    if (!viewOnly) return
    if (!auth.currentUser) signInAnonymously(auth).catch(() => {})
  }, [viewOnly])
  useEffect(() => (viewOnly ? undefined : subscribeMembers(setMembers)), [viewOnly])
  useEffect(() => subscribeActiveSession(setSession), [])
  useEffect(() => (session ? subscribeSessionEntries(session.id, setEntries) : setEntries([]) || undefined), [session])
  useEffect(() => subscribeScanEvents(setEvents, 60), [])
  useEffect(() => { membersRef.current = members }, [members])
  useEffect(() => { sessionRef.current = session }, [session])
  useEffect(() => { entriesRef.current = entries }, [entries])
  useEffect(() => { modeRef.current = mode }, [mode])
  useEffect(() => {
    if (viewOnly) return undefined
    const prime = () => primeAudio()
    window.addEventListener('pointerdown', prime, { once: true })
    return () => window.removeEventListener('pointerdown', prime)
  }, [viewOnly])

  // ---- The instant engine --------------------------------------------------
  function pushLocal(row) {
    const localId = `local_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    setLocalRows((rs) => [{ ...row, localId, atMs: Date.now() }, ...rs].slice(0, 8))
    return localId
  }
  function dropLocal(localId) {
    // Small delay so the definitive cloud row is already on screen — no blink.
    setTimeout(() => setLocalRows((rs) => rs.filter((r) => r.localId !== localId)), 900)
  }

  async function onCode(code, reader) {
    if (!code || viewOnly) return
    const gate = reader || 'desk'
    const key = `${gate}:${code}`
    const now = Date.now()
    if (recent.current.get(key) && now - recent.current.get(key) < 3500) return
    recent.current.set(key, now)

    const cached = resolveMemberLocal(code, membersRef.current)
    const entry = cached ? entriesRef.current.find((e) => e.memberId === cached.id) : null

    // 1) INSTANT verdict from local data — light, sound, row, all now.
    let verdict
    if (!cached) verdict = { ok: false, kind: 'notreg' }
    else if (modeRef.current === 'out') verdict = { ok: true, kind: entry && !entry.exitedAt ? 'left' : 'notin' }
    else if (entry && !entry.exitedAt) verdict = { ok: true, kind: 'already' }
    else if (entry && entry.exitedAt) verdict = { ok: true, kind: 'reentry' }
    else if ((cached.credits || 0) < 1) verdict = { ok: false, kind: 'low' }
    else verdict = { ok: true, kind: 'welcome' }

    feedback(verdict.ok)
    sendReaderFeedback(gate, verdict.ok)
    const localId = pushLocal({
      ok: verdict.ok,
      kind: verdict.kind,
      memberId: cached?.id || '',
      name: cached?.name || '',
      photoURL: cached?.photoURL || '',
      mobile: cached?.mobile || '',
      credits: verdict.kind === 'welcome' ? (cached.credits || 1) - 1 : cached?.credits || 0,
      gate,
    })

    // 2) The cloud confirms in the background (authoritative, race-safe).
    try {
      const member = cached || (await resolveMember(code, membersRef.current))
      if (!member) {
        logScanEvent({ ok: false, kind: 'notreg', memberId: '', name: '', photoURL: '', mobile: '', credits: 0, gate })
        dropLocal(localId)
        return
      }
      const sess = sessionRef.current || (await ensureActiveSession())
      let res
      if (modeRef.current === 'out') res = await markExit(member, sess)
      else res = await checkIn(member, sess, { gate })
      const kind = res.kind
      const m = res.member || member
      logScanEvent({
        ok: res.ok,
        kind,
        memberId: m.id,
        name: m.name || '',
        photoURL: m.photoURL || '',
        mobile: m.mobile || '',
        credits: res.credits ?? m.credits ?? 0,
        gate,
      })
      // Rare: local said green but the cloud disagreed (or vice versa).
      if (res.ok !== verdict.ok) feedback(res.ok)
      dropLocal(localId)
    } catch {
      // Offline: the instant verdict stands; the entry syncs when wifi returns
      // (Firestore queues the write). Nothing for the receptionist to do.
      dropLocal(localId)
    }
  }
  useCardWedge(onCode, !viewOnly)
  useLocalReader(viewOnly ? () => {} : onCode)

  // Hidden always-focused input so a keyboard-style QR gun never types into
  // the wrong place.
  useEffect(() => {
    if (viewOnly) return undefined
    const grab = () => {
      const el = catcher.current
      if (el && document.activeElement !== el && !rechargeFor && !panel) el.focus()
    }
    grab()
    const id = setInterval(grab, 400)
    window.addEventListener('focus', grab)
    return () => { clearInterval(id); window.removeEventListener('focus', grab) }
  }, [viewOnly, rechargeFor, panel])
  function flushCatcher() {
    const el = catcher.current
    if (!el) return
    const v = el.value.trim()
    el.value = ''
    if (v.length >= 3) onCode(normalizeCode(v), 'desk')
  }

  // ---- Derived numbers -----------------------------------------------------
  const inside = entries.filter((e) => !e.exitedAt).reduce((n, e) => n + 1 + (e.guests || 0), 0)
  const today = entries.reduce((n, e) => n + 1 + (e.guests || 0), 0)
  const memberById = useMemo(() => Object.fromEntries(members.map((m) => [m.id, m])), [members])
  const entryByMember = useMemo(() => Object.fromEntries(entries.map((e) => [e.memberId, e])), [entries])

  // Board rows: optimistic local rows first, then the cloud feed (deduped).
  const rows = useMemo(() => {
    const localKeys = new Set(localRows.map((r) => `${r.memberId}:${r.kind}`))
    const cloud = events.filter((e) => !(e.memberId && localKeys.has(`${e.memberId}:${e.kind}`) && (Date.now() - (e.at?.seconds || 0) * 1000) < 8000))
    return [...localRows, ...cloud]
  }, [localRows, events])

  const q = search.trim().toLowerCase()
  const matches = q
    ? members.filter((m) => (m.name || '').toLowerCase().includes(q) || (m.mobile || '').includes(q)).slice(0, 8)
    : []

  const lineFor = {
    welcome: 'Entered',
    reentry: 'Welcome back',
    already: 'Already inside',
    left: 'Left · marked out',
    notin: 'Was not inside',
    low: 'NO CREDITS — call them over',
    notreg: 'Card not registered — search their name below',
  }

  async function manualCheckIn(m) {
    setBusyId(m.id)
    try {
      const sess = sessionRef.current || (await ensureActiveSession())
      const res = await checkIn(m, sess, { gate: 'desk', method: 'manual' })
      feedback(res.ok)
      logScanEvent({ ok: res.ok, kind: res.kind, memberId: m.id, name: m.name || '', photoURL: m.photoURL || '', mobile: m.mobile || '', credits: res.credits ?? 0, gate: 'desk' })
      if (res.ok) { setPanel(false); setSearch('') }
    } finally { setBusyId('') }
  }

  async function guestFor(memberId) {
    setBusyId(memberId)
    try {
      const sess = sessionRef.current
      if (!sess) return
      await addGuest(memberId, sess)
      feedback(true)
    } catch (e) {
      alert(e.message || 'Could not add guest')
    } finally { setBusyId('') }
  }

  async function stopDay() {
    if (!session || !window.confirm('End today’s session? The inside count resets for next Saturday.')) return
    setEnding(true)
    try { await endSession(session.id) } finally { setEnding(false) }
  }

  return (
    <div className="gfeed" onClick={() => !viewOnly && !rechargeFor && !panel && catcher.current?.focus()}>
      {!viewOnly && (
        <input
          ref={catcher} className="scan-catcher" inputMode="none" autoFocus autoComplete="off"
          aria-label="Scan capture"
          onKeyDown={(e) => { if (e.key === 'Enter') { if (flushTimer.current) clearTimeout(flushTimer.current); flushCatcher() } }}
          onInput={() => { if (flushTimer.current) clearTimeout(flushTimer.current); flushTimer.current = setTimeout(flushCatcher, 160) }}
        />
      )}

      <header className="gfeed-top">
        <div>
          <div className="gfeed-title">🌿 {viewOnly ? 'Live Board' : 'Reception'}</div>
          <div className="gfeed-sub">
            {session ? '🟢 Session live' : '⏳ Starts with the first tap'}
            {!viewOnly && <span className="scan-ready"> · 🔴 Reader armed</span>}
          </div>
        </div>
        <div className="gfeed-stats">
          <ThemeToggle />
          <div className="gfeed-count"><b>{inside}</b><span>inside</span></div>
          <div className="gfeed-count"><b>{today}</b><span>today</span></div>
          {!viewOnly && (
            <div className="gfeed-ctrl">
              <div className="seg inout">
                <button className={mode === 'in' ? 'on' : ''} onClick={() => setMode('in')}>↓ In</button>
                <button className={mode === 'out' ? 'on out' : ''} onClick={() => setMode('out')}>↑ Out</button>
              </div>
              <button className="btn ghost small" onClick={() => setPanel(true)}>🔍 Find member</button>
              {session && <button className="btn danger small" onClick={stopDay} disabled={ending}>End session</button>}
              <Link className="btn ghost small" to="/owner" title="Owner">⚙</Link>
            </div>
          )}
        </div>
      </header>

      {!viewOnly && mode === 'out' && (
        <div className="gfeed-startbanner">↑ OUT mode — taps now mark people as LEFT (never charges). Switch back to In for entries.</div>
      )}

      <div className="gfeed-list">
        {rows.length === 0 && (
          <div className="gfeed-empty">Entries appear here the moment someone taps their card or shows their QR.</div>
        )}
        {rows.map((e) => {
          const low = !e.ok && e.kind === 'low'
          const entry = e.memberId ? entryByMember[e.memberId] : null
          const canGuest = !viewOnly && e.ok && entry && !entry.exitedAt && session
          const canRecharge = !viewOnly && low && e.memberId
          const couple = e.memberId && memberById[e.memberId]?.couple
          return (
            <div key={e.localId || e.id} className={`gfeed-row ${e.ok ? 'ok' : low ? 'nocredit' : 'err'}`}>
              <span className="gfeed-mark">{e.ok ? '✓' : '✗'}</span>
              {e.photoURL
                ? <img className="gfeed-face" src={e.photoURL} alt="" />
                : <span className="gfeed-face fb">{(e.name || '?')[0]}</span>}
              <div className="gfeed-body">
                <div className="gfeed-name">{e.name || 'Unknown card'}{couple ? ' 👫' : ''}{entry?.guests ? ` +${entry.guests}` : ''}</div>
                <div className="gfeed-line">{lineFor[e.kind] || e.kind}{e.mobile ? ` · ${e.mobile}` : ''}</div>
              </div>
              <div className="gfeed-meta">
                {canRecharge ? (
                  <button className="gfeed-recharge" onClick={() => setRecharge(memberById[e.memberId] || e)}>🎟️ Recharge</button>
                ) : canGuest ? (
                  <button className="gfeed-guest" disabled={busyId === e.memberId} onClick={() => guestFor(e.memberId)}>+ Guest</button>
                ) : (
                  <span className={`gfeed-cr ${e.ok ? '' : 'low'}`}>{e.credits ?? 0} cr</span>
                )}
                <span className="gfeed-time">{fmtTime(e)}</span>
              </div>
            </div>
          )
        })}
      </div>

      {/* Find member — check in, recharge, assign a first card */}
      {panel && !viewOnly && (
        <div className="manual-panel">
          <div className="manual-head">
            <span className="strong">Find member</span>
            <button className="btn ghost small" onClick={() => { setPanel(false); setSearch('') }}>Close</button>
          </div>
          <input autoFocus placeholder="Name or mobile…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <div className="manual-list">
            {matches.map((m) => {
              const e = entryByMember[m.id]
              return (
                <div key={m.id} className="manual-row" style={{ cursor: 'default' }}>
                  {m.photoURL ? <img src={m.photoURL} alt="" /> : <span className="avatar-fallback sm">{(m.name || '?')[0]}</span>}
                  <span className="manual-name">
                    {m.name}{m.couple ? ' 👫' : ''}
                    <span className="muted small"> · {m.credits || 0} cr{e && !e.exitedAt ? ' · inside' : ''}</span>
                  </span>
                  <span className="row gap">
                    {(!e || e.exitedAt) && (
                      <button className="btn small primary" disabled={busyId === m.id} onClick={() => manualCheckIn(m)}>Check in</button>
                    )}
                    <button className="btn small" onClick={() => { setPanel(false); setRecharge(m) }}>Recharge</button>
                    <AssignCardButton member={m} all={members} />
                  </span>
                </div>
              )
            })}
            {q && matches.length === 0 && <div className="muted small">No member matches “{search}”.</div>}
            {!q && <div className="muted small">Type a name or mobile number.</div>}
          </div>
        </div>
      )}

      {rechargeFor && !viewOnly && (
        <RechargePanel member={rechargeFor} onClose={() => setRecharge(null)} />
      )}
    </div>
  )
}

// First-card assign, right from the desk: press, tap the blank card, done.
// (For a stack of cards use Card Tracking → Assign cards — tap card, pick name.)
function AssignCardButton({ member, all = [] }) {
  const [state, setState] = useState('idle') // idle | wait | done | err
  function arm() {
    setState('wait')
    document.activeElement?.blur()
    let cb, ck, timer, done = false
    const finish = async (uid) => {
      if (done) return
      done = true
      cb?.(); ck?.(); clearTimeout(timer)
      if (!uid) { setState('err'); setTimeout(() => setState('idle'), 2000); return }
      try { await assignCard(member.id, uid, all); setState('done'); setTimeout(() => setState('idle'), 2500) }
      catch { setState('err'); setTimeout(() => setState('idle'), 2000) }
    }
    cb = captureNextCard(finish)
    ck = captureOneCard(finish)
    timer = setTimeout(() => finish(''), 20000)
  }
  const label = { idle: member.cardUid ? '💳 ✓' : '💳 Assign card', wait: 'Tap card…', done: '✓ Assigned', err: 'Missed — retry' }[state]
  return <button className="btn small" disabled={state === 'wait'} onClick={arm} title={member.cardUid ? `Card ${member.cardUid} — tap to replace` : 'Assign a card'}>{label}</button>
}

// One recharge = packs of PACK_CREDITS, priced by the member's level.
function RechargePanel({ member, onClose }) {
  const [packs, setPacks] = useState(1)
  const [method, setMethod] = useState('cash')
  const [reference, setReference] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState('')
  const amount = packPrice(member.tier) * packs
  const credits = PACK_CREDITS * packs

  async function save() {
    setBusy(true)
    try {
      const r = await recharge(member.id, packs, { method, ref: reference })
      setDone(`✓ ${r.credits} credits added — balance ${r.total}. Ask ${(member.name || '').split(' ')[0]} to tap again.`)
      setTimeout(onClose, 1700)
    } catch (e) {
      setDone(e.message || 'Recharge failed')
      setBusy(false)
    }
  }

  return (
    <div className="recharge-overlay" onClick={onClose}>
      <div className="recharge-panel" onClick={(e) => e.stopPropagation()}>
        <div className="recharge-head">
          {member.photoURL ? <img src={member.photoURL} alt="" /> : <span className="avatar-fallback">{(member.name || '?')[0]}</span>}
          <div>
            <div className="recharge-name">{member.name}</div>
            <div className="muted small">{member.tier || 'Associate'} · {member.credits || 0} credits now</div>
          </div>
          <button className="btn ghost small" onClick={onClose}>✕</button>
        </div>
        {done ? (
          <div className="banner" style={{ marginTop: 6 }}>{done}</div>
        ) : (
          <>
            <div className="recharge-credits">
              {[1, 2, 3].map((p) => (
                <button key={p} className={`amt-chip ${packs === p ? 'on' : ''}`} onClick={() => setPacks(p)}>
                  {p * PACK_CREDITS} credits
                </button>
              ))}
            </div>
            <div className="recharge-amt">{CURRENCY}{amount} <span className="muted small">· {credits} entries</span></div>
            <div className="recharge-methods">
              <button className={`amt-chip ${method === 'cash' ? 'on' : ''}`} onClick={() => setMethod('cash')}>💵 Cash</button>
              <button className={`amt-chip ${method === 'upi' ? 'on' : ''}`} onClick={() => setMethod('upi')}>📲 UPI</button>
            </div>
            {method === 'upi' && (
              <input placeholder="UPI ref (optional)" value={reference} onChange={(e) => setReference(e.target.value)} />
            )}
            <button className="btn primary block" onClick={save} disabled={busy}>
              {busy ? 'Saving…' : `Recharge ${credits} credits · ${CURRENCY}${amount}`}
            </button>
          </>
        )}
      </div>
    </div>
  )
}

function fmtTime(e) {
  if (e.atMs) return 'now'
  if (!e.at?.seconds) return 'now'
  return new Date(e.at.seconds * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
