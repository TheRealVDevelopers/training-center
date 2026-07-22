import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { CURRENCY, SESSION, PACK_CREDITS, packPrice } from '../config'
import {
  subscribeActiveSession,
  subscribeSessionBookings,
  subscribeScanEvents,
  subscribeMembers,
  subscribeAllTopups,
  checkInMember,
  rechargePacks,
  logScanEvent,
  startSession,
  endSession,
} from '../lib/db'
import { useWakeLock } from '../lib/wakeLock'
import { useCardWedge } from '../lib/wedge'
import { useLocalReader, sendReaderFeedback } from '../lib/localReader'
import { normalizeCode } from '../lib/readerId'
import { feedback, primeAudio } from '../lib/feedback'

// The ONE reception screen. The receptionist sits and watches: every tap (desk
// or door reader) streams in as a face — green = entered, big RED = no credits.
// A red row has a one-tap "Recharge" right on it; top up, member taps again, in.
//  - control=true (at /admin): reads the readers, checks members in, recharges.
//  - control=false (at /feed): view-only, opened on a phone via the door's QR.
export default function GateFeed({ control = false }) {
  const [events, setEvents] = useState([])
  const [session, setSession] = useState(null)
  const [bookings, setBookings] = useState([])
  const [members, setMembers] = useState([])
  const [topups, setTopups] = useState([])
  const [busy, setBusy] = useState(false)
  const [recharge, setRecharge] = useState(null) // { memberId, name, mobile, photoURL } | null
  const [moreOpen, setMoreOpen] = useState(false)
  const sessionRef = useRef(null)
  const recent = useRef(new Map())
  const catcher = useRef(null)
  const flushTimer = useRef(null)

  useWakeLock(true)
  useEffect(() => subscribeScanEvents(setEvents, 50), [])
  useEffect(() => subscribeActiveSession(setSession), [])
  useEffect(() => (session ? subscribeSessionBookings(session.id, setBookings) : undefined), [session])
  useEffect(() => (control ? subscribeMembers(setMembers) : undefined), [control])
  useEffect(() => (control ? subscribeAllTopups(setTopups) : undefined), [control])
  useEffect(() => { sessionRef.current = session }, [session])
  useEffect(() => {
    if (!control) return undefined
    const prime = () => primeAudio()
    window.addEventListener('pointerdown', prime, { once: true })
    return () => window.removeEventListener('pointerdown', prime)
  }, [control])

  // A tap/scan is read HERE (any reader) → checked in → shown. On /feed
  // (control=false) this never runs; that view only displays what others log.
  async function onScan(code, reader) {
    if (!code) return
    const gate = reader || 'desk'
    const now = Date.now()
    const key = `${gate}:${code}`
    if (recent.current.get(key) && now - recent.current.get(key) < 3500) return
    recent.current.set(key, now)

    const sess = sessionRef.current
    const base = (m) => ({ memberId: m?.id || '', name: m?.name || '', photoURL: m?.photoURL || '', mobile: m?.mobile || '', tier: m?.tier || '' })

    const res = await checkInMember(code, gate, sess)
    const ledOk = res.ok || res.reason === 'already'
    feedback(ledOk)
    sendReaderFeedback(gate, ledOk) // door reader LED: green in / red to desk

    if (res.ok) logScanEvent({ gate, ok: true, kind: res.reason === 'reentry' ? 'reentry' : 'welcome', ...base(res.member), credits: res.sessionsLeft ?? 0 })
    else if (res.reason === 'already') logScanEvent({ gate, ok: true, kind: 'already', ...base(res.member), credits: res.sessionsLeft ?? 0 })
    else if (res.reason === 'insufficient') logScanEvent({ gate, ok: false, kind: 'low', ...base(res.member), credits: 0 })
    else if (res.reason === 'nosession') logScanEvent({ gate, ok: false, kind: 'nosession', memberId: '', name: '', photoURL: '', mobile: '', credits: 0 })
    else logScanEvent({ gate, ok: false, kind: 'notreg', memberId: '', name: '', photoURL: '', mobile: '', credits: 0 })
  }
  useCardWedge(onScan, control) // QR gun / keyboard-mode reader
  useLocalReader(control ? onScan : () => {}) // USB / ACR122U readers via the bridge

  // Keep a hidden input focused so a keyboard-style QR gun ALWAYS types into it
  // (never leaks the code into random fields). Re-grabs focus if anything steals it.
  useEffect(() => {
    if (!control) return undefined
    const grab = () => { const el = catcher.current; if (el && document.activeElement !== el && !recharge) el.focus() }
    grab()
    const id = setInterval(grab, 400)
    window.addEventListener('focus', grab)
    return () => { clearInterval(id); window.removeEventListener('focus', grab) }
  }, [control, recharge])

  function flushCatcher() {
    const el = catcher.current
    if (!el) return
    const v = el.value.trim()
    el.value = ''
    if (v.length >= 3) onScan(normalizeCode(v), 'desk')
  }
  function onCatcherKey(e) {
    if (e.key === 'Enter') { if (flushTimer.current) clearTimeout(flushTimer.current); flushCatcher() }
  }
  function onCatcherInput() {
    if (flushTimer.current) clearTimeout(flushTimer.current)
    flushTimer.current = setTimeout(flushCatcher, 160)
  }

  const checkedIn = useMemo(() => bookings.filter((b) => b.status === 'checked_in'), [bookings])
  const insideNow = checkedIn.filter((b) => !b.exitedAt).reduce((n, b) => n + (b.peopleCount || 0), 0)
  const today = checkedIn.reduce((n, b) => n + (b.peopleCount || 0), 0)

  // Live analytics shown right on the reception screen (control view only).
  const fee = session?.feePerPerson ?? SESSION.feePerPerson
  const enrolled = members.length
  const lowBalance = useMemo(() => members.filter((m) => (m.balance || 0) < fee).length, [members, fee])
  const paymentsToday = useMemo(() => {
    const midnight = new Date(); midnight.setHours(0, 0, 0, 0)
    const from = midnight.getTime() / 1000
    return topups.filter((t) => (t.createdAt?.seconds || 0) >= from).reduce((n, t) => n + (t.amount || 0), 0)
  }, [topups])

  const lineFor = {
    welcome: 'Entered',
    reentry: 'Welcome back',
    already: 'Already inside',
    low: 'NO CREDITS — recharge to enter',
    notreg: 'Unknown card → assign at desk',
    nosession: 'No session running',
  }

  async function start() { setBusy(true); try { await startSession() } finally { setBusy(false) } }
  async function stop() {
    if (!session || !window.confirm('End the session? The live count resets for next time.')) return
    setBusy(true); try { await endSession(session.id) } finally { setBusy(false) }
  }

  return (
    <div className="gfeed" onClick={() => control && !recharge && catcher.current?.focus()}>
      {control && (
        <input
          ref={catcher} className="scan-catcher" inputMode="none" autoFocus autoComplete="off"
          aria-label="Scan capture" onKeyDown={onCatcherKey} onInput={onCatcherInput}
        />
      )}
      <header className="gfeed-top">
        <div>
          <div className="gfeed-title">🌿 {control ? 'Reception' : 'Live Board'}</div>
          <div className="gfeed-sub">
            {session ? '🟢 Session live' : '⏳ No active session'}
            {control && <span className="scan-ready"> · 🔴 Reader armed</span>}
          </div>
        </div>
        <div className="gfeed-stats">
          <div className="gfeed-count"><b>{insideNow}</b><span>inside</span></div>
          <div className="gfeed-count"><b>{today}</b><span>today</span></div>
          {control && (
            <div className="gfeed-ctrl">
              {session
                ? <button className="btn danger small" onClick={stop} disabled={busy}>End session</button>
                : <button className="btn primary small" onClick={start} disabled={busy}>{busy ? '…' : 'Start session'}</button>}
              <div className="gfeed-more">
                <button className="btn ghost small" onClick={() => setMoreOpen((v) => !v)}>⚙ More</button>
                {moreOpen && (
                  <div className="gfeed-menu" onClick={() => setMoreOpen(false)}>
                    <Link to="/admin/credits">💰 Credits &amp; cards</Link>
                    <Link to="/admin/cards">🪪 Card tracking</Link>
                    <Link to="/admin/command">📊 Analytics</Link>
                    <Link to="/admin/report">🧾 Daily report</Link>
                    <Link to="/super">🛡️ Super Admin</Link>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </header>

      {control && (
        <div className="gfeed-metrics">
          <div className="gfm"><b>{enrolled}</b><span>Enrolled</span></div>
          <div className="gfm"><b>{today}</b><span>Entered today</span></div>
          <div className="gfm"><b>{insideNow}</b><span>Inside now</span></div>
          <div className="gfm"><b>{CURRENCY}{paymentsToday}</b><span>Payments today</span></div>
          <div className={`gfm ${lowBalance ? 'warn' : ''}`}><b>{lowBalance}</b><span>Low balance</span></div>
          <Link className="gfm-link" to="/admin/command">Full analytics ›</Link>
        </div>
      )}

      {control && !session && (
        <div className="gfeed-startbanner">Start the session to open the doors. Members can’t check in until then.</div>
      )}

      <div className="gfeed-list">
        {events.length === 0 && (
          <div className="gfeed-empty">Entries appear here live the moment someone taps or scans at the desk or a door.</div>
        )}
        {events.map((e) => {
          const low = !e.ok && e.kind === 'low'
          const canRecharge = control && low && e.memberId
          return (
            <div
              key={e.id}
              className={`gfeed-row ${e.ok ? 'ok' : low ? 'nocredit' : 'err'} ${canRecharge ? 'clickable' : ''}`}
              onClick={canRecharge ? () => setRecharge({ memberId: e.memberId, name: e.name, mobile: e.mobile, photoURL: e.photoURL, tier: e.tier }) : undefined}
            >
              <span className="gfeed-mark">{e.ok ? '✓' : '✗'}</span>
              {e.photoURL
                ? <img className="gfeed-face" src={e.photoURL} alt="" />
                : <span className="gfeed-face fb">{(e.name || '?')[0]}</span>}
              <div className="gfeed-body">
                <div className="gfeed-name">{e.name || 'Unknown card'}</div>
                <div className="gfeed-line">
                  {lineFor[e.kind] || e.kind}
                  {e.mobile ? ` · ${e.mobile}` : ''}
                </div>
              </div>
              <div className="gfeed-meta">
                {canRecharge
                  ? <button className="gfeed-recharge" onClick={(ev) => { ev.stopPropagation(); setRecharge({ memberId: e.memberId, name: e.name, mobile: e.mobile, photoURL: e.photoURL, tier: e.tier }) }}>🎟️ Recharge</button>
                  : <span className={`gfeed-cr ${e.ok ? '' : 'low'}`}>{e.ok ? `${e.credits ?? 0} cr` : '0 cr'}</span>}
                <span className="gfeed-time">{fmtTime(e.at)}</span>
              </div>
            </div>
          )
        })}
      </div>

      {recharge && (
        <RechargePanel
          member={recharge}
          sessionFee={session?.feePerPerson ?? SESSION.feePerPerson}
          onClose={() => setRecharge(null)}
        />
      )}
    </div>
  )
}

// Inline recharge — the receptionist's "open profile and top up" in one step.
// Credits sell in packs of PACK_CREDITS; the ₹ price comes from the member's
// tier. After saving, the member taps their card again and walks straight in.
function RechargePanel({ member, sessionFee, onClose }) {
  const [method, setMethod] = useState('cash')
  const [ref, setRef] = useState('')
  const [packs, setPacks] = useState(1)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState('')
  const perPack = member.tier ? packPrice(member.tier) : sessionFee * PACK_CREDITS
  const credits = packs * PACK_CREDITS
  const amount = packs * perPack

  async function save() {
    setBusy(true)
    try {
      const r = await rechargePacks(member.memberId, packs, { method, ref, sessionFee, note: `Recharge · ${credits} credits · ${method}${ref ? ` · ${ref}` : ''}` })
      setDone(`✓ ${r.credits} credits added (${CURRENCY}${r.amount}) — ask ${member.name.split(' ')[0]} to tap again.`)
      setTimeout(onClose, 1600)
    } catch (e) {
      setDone(e.message || 'Recharge failed')
      setBusy(false)
    }
  }

  return (
    <div className="recharge-overlay" onClick={onClose}>
      <div className="recharge-panel" onClick={(e) => e.stopPropagation()}>
        <div className="recharge-head">
          {member.photoURL
            ? <img src={member.photoURL} alt="" />
            : <span className="avatar-fallback">{(member.name || '?')[0]}</span>}
          <div>
            <div className="recharge-name">{member.name}</div>
            <div className="muted small">{member.tier || 'No tier'}{member.mobile ? ` · ${member.mobile}` : ''}</div>
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
              <input placeholder="UPI ref / receipt no. (optional)" value={ref} onChange={(e) => setRef(e.target.value)} />
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

function fmtTime(ts) {
  if (!ts?.seconds) return 'now'
  return new Date(ts.seconds * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
