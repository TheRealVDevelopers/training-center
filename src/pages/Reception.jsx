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
  subscribeAllPayments,
  resolveMemberLocal,
  resolveMember,
  ensureActiveSession,
  endSession,
  checkIn,
  markExit,
  addGuest,
  recharge,
  assignCard,
  cardsAllowed,
  adjustCredits,
  logScanEvent,
} from '../lib/db'
import { useWakeLock } from '../lib/wakeLock'
import { useCardWedge, captureOneCard } from '../lib/wedge'
import { useLocalReader, sendReaderFeedback, captureNextCard } from '../lib/localReader'
import { normalizeCode } from '../lib/readerId'
import { feedback, primeAudio } from '../lib/feedback'
import { getDeviceLabel, setDeviceLabel } from '../lib/actor'
import ThemeToggle from '../components/ThemeToggle'
import { QRCodeCanvas } from 'qrcode.react'

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
  const [payments, setPayments] = useState([])
  const [localRows, setLocalRows] = useState([]) // optimistic rows, instant
  const [mode, setMode] = useState('in') // 'in' | 'out'
  const [rechargeFor, setRecharge] = useState(null) // member | null
  const [creditsFor, setCreditsFor] = useState(null) // member | null — fix a balance
  const [assignUid, setAssignUid] = useState('') // unknown card waiting for an owner
  const [panel, setPanel] = useState(false) // false | 'find' | 'renewal'
  const [search, setSearch] = useState('')
  const [busyId, setBusyId] = useState('')
  const [ending, setEnding] = useState(false)
  const [deviceOpen, setDeviceOpen] = useState(false)
  const [device, setDevice] = useState(() => getDeviceLabel())
  // Board style: 'cards' (default) or 'lines' (compact straight-line rows).
  const [viewMode, setViewMode] = useState(() => localStorage.getItem('board_view') || 'cards')
  function toggleView() {
    const v = viewMode === 'cards' ? 'lines' : 'cards'
    setViewMode(v)
    localStorage.setItem('board_view', v)
  }
  // Self-diagnosis: is the USB bridge alive, when did a read last REACH this
  // page, and does the window actually have focus (a QR gun types keystrokes —
  // if another window is focused, the gun beeps but the board hears nothing).
  const [bridgeUp, setBridgeUp] = useState(null)
  const [lastRead, setLastRead] = useState(null)
  const [winFocused, setWinFocused] = useState(true)
  // Reader test mode: while open, every tap/scan is echoed here and NOBODY is
  // charged — it exercises the exact same input path the real check-in uses.
  const [testing, setTesting] = useState(false)
  const [testLog, setTestLog] = useState([])
  const testingRef = useRef(false)
  useEffect(() => { testingRef.current = testing }, [testing])
  useEffect(() => {
    if (viewOnly) return undefined
    const check = () => setWinFocused(document.hasFocus())
    check()
    const id = setInterval(check, 700)
    window.addEventListener('focus', check)
    window.addEventListener('blur', check)
    return () => { clearInterval(id); window.removeEventListener('focus', check); window.removeEventListener('blur', check) }
  }, [viewOnly])

  const membersRef = useRef([])
  const sessionRef = useRef(null)
  const entriesRef = useRef([])
  const modeRef = useRef('in')
  const assignRef = useRef('')
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
  useEffect(() => (viewOnly ? undefined : subscribeAllPayments(setPayments)), [viewOnly])
  useEffect(() => { membersRef.current = members }, [members])
  useEffect(() => { sessionRef.current = session }, [session])
  useEffect(() => { entriesRef.current = entries }, [entries])
  useEffect(() => { modeRef.current = mode }, [mode])
  useEffect(() => { assignRef.current = assignUid }, [assignUid])
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
    setLastRead(new Date()) // proof on screen that the read reached the app

    // The catcher (QR gun typing) tags itself 'gun'; only the USB bridge sends
    // real reader names (desk / gate1 / gate2).
    const fromGun = reader === 'gun' || !reader

    // TEST MODE: echo the read, charge nobody. No dedup — tap as often as you like.
    if (testingRef.current) {
      const c = normalizeCode(code)
      const m = resolveMemberLocal(code, membersRef.current)
      feedback(true)
      setTestLog((l) => [{
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        time: new Date(),
        source: fromGun ? '⌨ QR gun / keyboard' : `🔌 USB · ${reader}`,
        raw: code,
        code: c,
        match: m ? { name: m.name, credits: m.credits || 0 } : null,
        isTestQr: c === 'TEST-QR-OK',
      }, ...l].slice(0, 20))
      return
    }

    const gate = fromGun ? 'desk' : reader
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
      creditsBefore: cached?.credits ?? null,
      credits: verdict.kind === 'welcome' ? (cached.credits || 1) - 1 : cached?.credits || 0,
      code: verdict.kind === 'notreg' ? normalizeCode(code) : '',
      gate,
    })

    // An unknown card just touched the reader and its owner is standing right
    // there. Ask who it belongs to NOW — type the name, assign, tap again.
    if (verdict.kind === 'notreg' && !assignRef.current) {
      setAssignUid(normalizeCode(code))
      setPanel(false)
    }

    // 2) The cloud confirms in the background (authoritative, race-safe).
    try {
      const member = cached || (await resolveMember(code, membersRef.current))
      if (!member) {
        // Keep the card number on the event so "💳 Whose card?" still works
        // from the red row even minutes later (tap at the gate, walk to desk).
        logScanEvent({ ok: false, kind: 'notreg', memberId: '', name: '', photoURL: '', mobile: '', credits: 0, code: normalizeCode(code), gate })
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
  useLocalReader(viewOnly ? () => {} : onCode, viewOnly ? undefined : setBridgeUp)

  // Hidden always-focused input so a keyboard-style QR gun never types into
  // the wrong place.
  useEffect(() => {
    if (viewOnly) return undefined
    const grab = () => {
      const el = catcher.current
      if (el && document.activeElement !== el && !rechargeFor && !panel && !assignUid && !creditsFor) el.focus()
    }
    grab()
    const id = setInterval(grab, 400)
    window.addEventListener('focus', grab)
    return () => { clearInterval(id); window.removeEventListener('focus', grab) }
  }, [viewOnly, rechargeFor, panel, assignUid, creditsFor])
  function flushCatcher() {
    const el = catcher.current
    if (!el) return
    const v = el.value.trim()
    el.value = ''
    if (v.length >= 3) {
      onCode(normalizeCode(v), 'gun')
    } else if (v.length > 0) {
      // Garbled / partial burst — still SHOW it, never swallow a read silently.
      setLastRead(new Date())
      feedback(false)
      pushLocal({ ok: false, kind: 'badread', memberId: '', name: '', photoURL: '', mobile: '', credits: 0, gate: 'desk' })
    }
  }

  // ---- Derived numbers -----------------------------------------------------
  const inside = entries.filter((e) => !e.exitedAt).reduce((n, e) => n + 1 + (e.guests || 0), 0)
  const today = entries.reduce((n, e) => n + 1 + (e.guests || 0), 0)
  // Renewals taken today — the other half of the end-of-day report.
  const renewedToday = useMemo(() => {
    const start = new Date(); start.setHours(0, 0, 0, 0)
    const s = start.getTime() / 1000
    const rows = payments.filter((p) => p.type === 'recharge' && (p.createdAt?.seconds || 0) >= s)
    return { count: rows.length, amount: rows.reduce((n, p) => n + (p.amount || 0), 0) }
  }, [payments])
  const memberById = useMemo(() => Object.fromEntries(members.map((m) => [m.id, m])), [members])
  const entryByMember = useMemo(() => Object.fromEntries(entries.map((e) => [e.memberId, e])), [entries])

  // Board rows: optimistic local rows first, then the cloud feed (deduped).
  // ONLY today's rows — every new day the board starts at zero; yesterday's
  // taps never linger on screen.
  const rows = useMemo(() => {
    const dayStart = new Date()
    dayStart.setHours(0, 0, 0, 0)
    const s = dayStart.getTime() / 1000
    const localKeys = new Set(localRows.map((r) => `${r.memberId}:${r.kind}`))
    const cloud = events
      .filter((e) => !e.at || e.at.seconds >= s)
      .filter((e) => !(e.memberId && localKeys.has(`${e.memberId}:${e.kind}`) && (Date.now() - (e.at?.seconds || 0) * 1000) < 8000))
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
    notreg: 'Unknown card — say whose it is, then tap again',
    badread: 'Couldn’t read that — tap / scan again slowly',
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
    <div className="gfeed" onClick={() => !viewOnly && !rechargeFor && !panel && !assignUid && !creditsFor && catcher.current?.focus()}>
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
            {!viewOnly && bridgeUp === true && <span className="scan-ready"> · 🔌 USB reader ✓</span>}
            {!viewOnly && bridgeUp === false && <span className="muted"> · USB bridge off</span>}
            {!viewOnly && lastRead && (
              <span className="muted"> · last read {lastRead.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
            )}
          </div>
        </div>
        <div className="gfeed-stats">
          <ThemeToggle />
          <button className="btn ghost small" onClick={toggleView} title="Switch board style">
            {viewMode === 'cards' ? '≡ Line view' : '▤ Card view'}
          </button>
          <div className="gfeed-count"><b>{inside}</b><span>inside</span></div>
          <div className="gfeed-count"><b>{today}</b><span>today</span></div>
          {!viewOnly && (
            <div className="gfeed-count" title={`${CURRENCY}${renewedToday.amount} collected today`}>
              <b>{renewedToday.count}</b><span>renewed</span>
            </div>
          )}
          {!viewOnly && (
            <div className="gfeed-ctrl">
              <div className="seg inout">
                <button className={mode === 'in' ? 'on' : ''} onClick={() => setMode('in')}>↓ In</button>
                <button className={mode === 'out' ? 'on out' : ''} onClick={() => setMode('out')}>↑ Out</button>
              </div>
              <button className="btn primary small" onClick={() => { setPanel('renewal'); setSearch('') }}>💳 Renewal</button>
              <button className="btn ghost small" onClick={() => { setPanel('find'); setSearch('') }}>✓ Mark attendance</button>
              <button className="btn ghost small" onClick={() => { setTesting(true); setTestLog([]) }}>🧪 Test readers</button>
              {session && <button className="btn danger small" onClick={stopDay} disabled={ending}>End session</button>}
              <button className="btn ghost small" onClick={() => setDeviceOpen(true)} title="Name this device — it appears on every payment in the activity log">
                🖥 {device}
              </button>
              <Link className="btn ghost small" to="/owner" title="Owner">⚙</Link>
            </div>
          )}
        </div>
      </header>

      {!viewOnly && !winFocused && (
        <div className="gfeed-focuswarn" onClick={() => { window.focus(); catcher.current?.focus() }}>
          ⚠ READERS CAN'T REACH THIS SCREEN — another window is selected. Click anywhere here, then tap again.
        </div>
      )}

      {!viewOnly && mode === 'out' && (
        <div className="gfeed-startbanner">↑ OUT mode — taps now mark people as LEFT (never charges). Switch back to In for entries.</div>
      )}

      <div className={`gfeed-list ${viewMode === 'lines' ? 'lines' : ''}`}>
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
                {!viewOnly && e.kind === 'notreg' && e.code ? (
                  <button className="gfeed-recharge" onClick={() => setAssignUid(e.code)}>💳 Whose card?</button>
                ) : canRecharge ? (
                  <button className="gfeed-recharge" onClick={() => setRecharge(memberById[e.memberId] || e)}>🎟️ Recharge</button>
                ) : canGuest ? (
                  <button className="gfeed-guest" disabled={busyId === e.memberId} onClick={() => guestFor(e.memberId)}>+ Guest</button>
                ) : (
                  <span className={`gfeed-cr ${e.ok ? '' : 'low'}`}>
                    {/* on a paid entry show what it cost them: 3 → 2 */}
                    {e.kind === 'welcome' && e.creditsBefore != null
                      ? <><span className="cr-was">{e.creditsBefore}</span> → {e.credits ?? 0} cr</>
                      : <>{e.credits ?? 0} cr</>}
                  </span>
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
            <span className="strong">{panel === 'renewal' ? '💳 Renewal — pick the member' : '✓ Mark attendance — no card needed'}</span>
            <button className="btn ghost small" onClick={() => { setPanel(false); setSearch('') }}>Close</button>
          </div>
          <input autoFocus placeholder="Type their name…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <div className="manual-list">
            {matches.map((m) => {
              const e = entryByMember[m.id]
              // Renewal mode: the whole row is the button — tap the name, confirm, done.
              if (panel === 'renewal') {
                return (
                  <button key={m.id} className="manual-row" onClick={() => { setPanel(false); setRecharge(m) }}>
                    {m.photoURL ? <img src={m.photoURL} alt="" /> : <span className="avatar-fallback sm">{(m.name || '?')[0]}</span>}
                    <span className="manual-name">
                      {m.name}{m.couple ? ' 👫' : ''}
                      <span className="muted small"> · {m.tier || 'Associate'} · {m.credits || 0} cr now</span>
                    </span>
                    <span className="asg-go">{CURRENCY}{packPrice(m.tier)} · +{PACK_CREDITS} ›</span>
                  </button>
                )
              }
              return (
                <div key={m.id} className="manual-row" style={{ cursor: 'default' }}>
                  {m.photoURL ? <img src={m.photoURL} alt="" /> : <span className="avatar-fallback sm">{(m.name || '?')[0]}</span>}
                  <span className="manual-name">
                    {m.name}{m.couple ? ' 👫' : ''}
                    <span className="muted small"> · {m.credits || 0} cr{e && !e.exitedAt ? ' · inside' : ''}</span>
                  </span>
                  <span className="row gap">
                    {(!e || e.exitedAt) && (
                      <button className="btn small primary" disabled={busyId === m.id} onClick={() => manualCheckIn(m)} title="Mark them present without a card — same as a tap">✓ Mark attendance</button>
                    )}
                    <button className="btn small" onClick={() => { setPanel(false); setRecharge(m) }}>Recharge</button>
                    <button className="btn small" onClick={() => { setPanel(false); setCreditsFor(m) }} title="Fix a wrong balance — no money involved">✎ Credits</button>
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

      {/* Name this device — shows against every payment in the activity log */}
      {deviceOpen && !viewOnly && (
        <div className="recharge-overlay" onClick={() => setDeviceOpen(false)}>
          <div className="recharge-panel" onClick={(e) => e.stopPropagation()}>
            <div className="recharge-head">
              <div>
                <div className="recharge-name">🖥 Name this device</div>
                <div className="muted small">Shown against every recharge taken here, so the owner can tell the desks apart.</div>
              </div>
              <button className="btn ghost small" onClick={() => setDeviceOpen(false)}>✕</button>
            </div>
            <label>Device name</label>
            <input
              autoFocus value={device} maxLength={24}
              onChange={(e) => setDevice(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { setDeviceLabel(device.trim() || 'Reception'); setDeviceOpen(false) } }}
              placeholder="Front desk"
            />
            <div className="row gap" style={{ marginTop: 8, flexWrap: 'wrap' }}>
              {['Front desk', 'Desk 2', 'Entry gate', 'Owner laptop'].map((s) => (
                <button key={s} type="button" className={`amt-chip ${device === s ? 'on' : ''}`} onClick={() => setDevice(s)}>{s}</button>
              ))}
            </div>
            <button className="btn primary block" onClick={() => { const v = device.trim() || 'Reception'; setDevice(v); setDeviceLabel(v); setDeviceOpen(false) }}>
              Save
            </button>
            <p className="muted small" style={{ margin: '10px 0 0' }}>
              Stored on this device only — each desk gets its own name.
            </p>
          </div>
        </div>
      )}

      {/* Reader test — slides over the board; taps echo here, nobody charged */}
      {testing && !viewOnly && (
        <div className="manual-panel">
          <div className="manual-head">
            <span className="strong">🧪 Reader test — nothing is saved, nobody is charged</span>
            <button className="btn primary small" onClick={() => setTesting(false)}>Done — back to entries</button>
          </div>

          <div className="row gap wrap" style={{ marginBottom: 10 }}>
            <span className={`tag ${winFocused ? 'ok' : 'pending'}`}>
              {winFocused ? '✓ Window focused — gun can type' : '✗ CLICK THIS WINDOW first'}
            </span>
            <span className={`tag ${bridgeUp ? 'ok' : 'pending'}`}>
              {bridgeUp ? '✓ USB card reader connected' : '✗ USB bridge off (start_pcsc.bat) — NFC taps won\'t arrive'}
            </span>
          </div>

          <div className="row gap wrap" style={{ alignItems: 'center' }}>
            <div className="qrwrap" style={{ margin: 0 }}>
              <QRCodeCanvas value="TEST-QR-OK" size={280} level="M" includeMargin style={{ width: 132, height: 132 }} />
            </div>
            <div className="muted small" style={{ flex: 1, minWidth: 200 }}>
              <b>1.</b> Scan this square with the QR gun → a ✓ row must appear below.<br />
              <b>2.</b> Tap any card on the NFC reader → a row shows its number (and the member, if assigned).<br />
              <b>3.</b> Tap the same things as many times as you like — test mode never charges.
            </div>
          </div>

          <div className="manual-list" style={{ marginTop: 12 }}>
            {testLog.length === 0 && <div className="muted small">Waiting for a scan or tap…</div>}
            {testLog.map((r) => (
              <div key={r.id} className="manual-row" style={{ cursor: 'default' }}>
                <span className="avatar-fallback sm">{r.isTestQr ? '🎯' : r.match ? '✓' : '?'}</span>
                <span className="manual-name" style={{ flex: 1, minWidth: 0 }}>
                  {r.isTestQr ? 'TEST QR read — gun works ✓' : r.match ? `${r.match.name} · ${r.match.credits} cr` : 'No member match'}
                  <span className="muted small" style={{ display: 'block', wordBreak: 'break-all' }}>
                    {r.source} · {r.raw.length} chars · {r.code.length > 40 ? `${r.code.slice(0, 40)}…` : r.code}
                  </span>
                </span>
                <span className="muted small">{r.time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {assignUid && !viewOnly && (
        <AssignOwnerPanel
          uid={assignUid}
          members={members}
          busyId={busyId}
          onClose={() => setAssignUid('')}
          onCheckIn={async (m) => { await manualCheckIn(m); setAssignUid('') }}
          onCredits={(m) => { setAssignUid(''); setCreditsFor(m) }}
        />
      )}

      {creditsFor && !viewOnly && (
        <CreditsPanel member={memberById[creditsFor.id] || creditsFor} onClose={() => setCreditsFor(null)} />
      )}

      {rechargeFor && !viewOnly && (
        <RechargePanel member={rechargeFor} onClose={() => setRecharge(null)} />
      )}
    </div>
  )
}

// An unknown card just touched the reader — and the person holding it is
// standing right there. This is the whole fix: type their name, tap the row,
// the card is theirs. Then they tap again and walk in.
function AssignOwnerPanel({ uid, members, busyId, onClose, onCheckIn, onCredits }) {
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [done, setDone] = useState(null) // { member, movedFrom, already }
  const t = q.trim().toLowerCase()
  const matches = t
    ? members.filter((m) => (m.name || '').toLowerCase().includes(t) || (m.mobile || '').includes(t)).slice(0, 8)
    : []
  // A hardware UID is short hex; anything longer is a QR/token payload.
  const pretty = /^[0-9A-F]{4,14}$/.test(uid) ? uid.replace(/(.{2})/g, '$1 ').trim() : uid

  async function give(m) {
    setBusy(m.id); setErr('')
    try {
      const r = await assignCard(m.id, uid, members)
      feedback(true)
      setDone({ member: m, ...r })
    } catch (e) {
      setErr(e.message || 'Could not save — try once more')
      feedback(false)
    } finally { setBusy('') }
  }

  return (
    <div className="recharge-overlay" onClick={onClose}>
      <div className="recharge-panel wide" onClick={(e) => e.stopPropagation()}>
        {done ? (
          <>
            <div className="asg-hit">
              <div className="asg-hit-tick">✓</div>
              <div>
                <div className="recharge-name">
                  {done.already ? 'Already their card' : 'Card given to'} {done.member.name}
                </div>
                <div className="muted small">
                  {done.movedFrom
                    ? `Taken off ${done.movedFrom} and moved here. `
                    : 'Ask them to tap again now — it will go green. '}
                  {/* Couples carry one card each — say how many are live. */}
                  <b>Now holds {done.uids.length} of {done.max} card{done.max === 1 ? '' : 's'}.</b>
                  {done.max === 2 && done.uids.length < 2 && ' Tap the second card to add it.'}
                </div>
                {done.dropped?.length > 0 && (
                  <div className="muted small">
                    Old card {done.dropped.join(', ')} no longer works — replaced by this one.
                  </div>
                )}
              </div>
            </div>
            <div className="row gap wrap" style={{ marginTop: 12 }}>
              <button className="btn primary" disabled={busyId === done.member.id} onClick={() => onCheckIn(done.member)}>
                ✓ Mark them in now
              </button>
              <button className="btn" onClick={() => onCredits(done.member)}>
                ✎ Credits ({done.member.credits || 0})
              </button>
              <button className="btn ghost" onClick={onClose}>Done</button>
            </div>
            <p className="muted small" style={{ margin: '10px 0 0' }}>
              Or just hand the card back — the next tap works straight away.
            </p>
          </>
        ) : (
          <>
            <div className="recharge-head">
              <span className="avatar-fallback">💳</span>
              <div>
                <div className="recharge-name">Whose card is this?</div>
                <div className="muted small">Card {pretty} — nobody owns it yet. Type their name.</div>
              </div>
              <button className="btn ghost small" onClick={onClose}>✕</button>
            </div>
            <input
              autoFocus placeholder="Type their name…" value={q}
              onChange={(e) => { setErr(''); setQ(e.target.value) }}
            />
            {err && <div className="error">{err}</div>}
            <div className="manual-list" style={{ marginTop: 8 }}>
              {matches.map((m) => (
                <button key={m.id} className="manual-row" disabled={!!busy} onClick={() => give(m)}>
                  {m.photoURL ? <img src={m.photoURL} alt="" /> : <span className="avatar-fallback sm">{(m.name || '?')[0]}</span>}
                  <span className="manual-name">
                    {m.name}{m.couple ? ' 👫' : ''}
                    <span className="muted small">
                      {' · '}{m.tier || 'Associate'} · {m.credits || 0} cr
                      {' · '}{cardsHeld(m)}/{cardsAllowed(m)} card{cardsAllowed(m) === 1 ? '' : 's'}
                      {m.couple ? ' 👫' : ''}
                    </span>
                  </span>
                  <span className="asg-go">{busy === m.id ? 'Saving…' : 'This is them ›'}</span>
                </button>
              ))}
              {t && matches.length === 0 && <div className="muted small">Nobody matches “{q}”.</div>}
              {!t && <div className="muted small">Start typing — the name list appears here.</div>}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// Fix a wrong balance on the spot. Set it to an exact number, or nudge it up
// and down. Every change lands in the ledger with a note, so the day's money
// still adds up at close.
function CreditsPanel({ member, onClose }) {
  const [bal, setBal] = useState(member.credits || 0)
  const [exact, setExact] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  async function apply(delta, note) {
    if (!delta || busy) return
    setBusy(true); setMsg('')
    try {
      const now = await adjustCredits(member.id, delta, note)
      setBal(now)
      setExact('')
      setMsg(`✓ ${member.name.split(' ')[0]} now has ${now} credit${now === 1 ? '' : 's'}`)
      feedback(true)
    } catch (e) {
      setMsg(e.message || 'Could not save')
      feedback(false)
    } finally { setBusy(false) }
  }

  const want = exact === '' ? null : Number(exact)
  const diff = want == null ? 0 : want - bal

  return (
    <div className="recharge-overlay" onClick={onClose}>
      <div className="recharge-panel" onClick={(e) => e.stopPropagation()}>
        <div className="recharge-head">
          {member.photoURL ? <img src={member.photoURL} alt="" /> : <span className="avatar-fallback">{(member.name || '?')[0]}</span>}
          <div>
            <div className="recharge-name">✎ {member.name}</div>
            <div className="muted small">{member.tier || 'Associate'} · fixing the credit balance</div>
          </div>
          <button className="btn ghost small" onClick={onClose}>✕</button>
        </div>

        <div className="cr-big">{bal}<span className="muted small"> credit{bal === 1 ? '' : 's'} now</span></div>

        <div className="recharge-credits">
          {[-5, -1, 1, 5].map((d) => (
            <button
              key={d} className={`amt-chip ${d < 0 ? 'minus' : ''}`} disabled={busy || (d < 0 && bal <= 0)}
              onClick={() => apply(d, d < 0 ? 'Reception correction — removed' : 'Reception correction — added')}
            >
              {d > 0 ? `＋${d}` : `−${Math.abs(d)}`}
            </button>
          ))}
        </div>

        <label style={{ marginTop: 10 }}>Or set it to exactly</label>
        <div className="row gap">
          <input
            inputMode="numeric" placeholder="e.g. 5" value={exact} style={{ width: 110 }}
            onChange={(e) => setExact(e.target.value.replace(/\D/g, ''))}
            onKeyDown={(e) => { if (e.key === 'Enter' && diff) apply(diff, `Reception correction — set to ${want}`) }}
          />
          <button
            className="btn primary" disabled={busy || want == null || diff === 0}
            onClick={() => apply(diff, `Reception correction — set to ${want}`)}
          >
            {want == null || diff === 0 ? 'Set' : `Set to ${want} (${diff > 0 ? '+' : ''}${diff})`}
          </button>
        </div>

        {msg && <div className="banner" style={{ marginTop: 10 }}>{msg}</div>}
        <p className="muted small" style={{ margin: '10px 0 0' }}>
          This does not take money. For a paid renewal use 💳 Renewal instead — that one goes on the day's takings.
        </p>
      </div>
    </div>
  )
}

const cardsHeld = (m) => (m.cardUids || (m.cardUid ? [m.cardUid] : [])).filter(Boolean).length

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
  const held = cardsHeld(member)
  const max = cardsAllowed(member)
  const label = {
    idle: held >= max ? `💳 ${held}/${max} ✓` : held ? `💳 add 2nd card` : '💳 Assign card',
    wait: 'Tap card…', done: '✓ Assigned', err: 'Missed — retry',
  }[state]
  const title = held
    ? `Has ${held} of ${max}: ${(member.cardUids || [member.cardUid]).filter(Boolean).join(', ')}`
    : 'Assign a card'
  return <button className="btn small" disabled={state === 'wait'} onClick={arm} title={title}>{label}</button>
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
