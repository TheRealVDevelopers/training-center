import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  subscribeActiveSession,
  subscribeSessionBookings,
  subscribeScanEvents,
  subscribeMembers,
  checkInMember,
  logScanEvent,
  startSession,
  endSession,
} from '../lib/db'
import { useWakeLock } from '../lib/wakeLock'
import { useCardWedge } from '../lib/wedge'
import { useLocalReader } from '../lib/localReader'
import { feedback, primeAudio } from '../lib/feedback'

// The MAIN live board. Streams every tap: green ✓ = entered, red ✗ = low
// credit → send to desk. Shows name, mobile and credits left.
//  - control=true (at /admin): adds session start/stop + links (staff & owner).
//  - control=false (at /feed): view-only, for door staff phones. ?gate= filters.
export default function GateFeed({ control = false }) {
  const gateFilter = new URLSearchParams(window.location.search).get('gate') || ''
  const [events, setEvents] = useState([])
  const [session, setSession] = useState(null)
  const [bookings, setBookings] = useState([])
  const [members, setMembers] = useState([])
  const [busy, setBusy] = useState(false)
  const sessionRef = useRef(null)
  const membersRef = useRef([])
  const recent = useRef(new Map())

  useWakeLock(true)
  useEffect(() => subscribeScanEvents(setEvents, 50), [])
  useEffect(() => subscribeActiveSession(setSession), [])
  useEffect(() => (session ? subscribeSessionBookings(session.id, setBookings) : undefined), [session])
  useEffect(() => (control ? subscribeMembers(setMembers) : undefined), [control])
  useEffect(() => { sessionRef.current = session }, [session])
  useEffect(() => { membersRef.current = members }, [members])
  useEffect(() => {
    if (!control) return undefined
    const prime = () => primeAudio()
    window.addEventListener('pointerdown', prime, { once: true })
    return () => window.removeEventListener('pointerdown', prime)
  }, [control])

  // On the /admin board, the tap/scan is read HERE and checked in, then shown.
  // (On the /feed phone view, control=false → it only displays.)
  async function onScan(code) {
    if (!code) return
    const now = Date.now()
    if (recent.current.get(code) && now - recent.current.get(code) < 3500) return
    recent.current.set(code, now)
    const sess = sessionRef.current
    const fee = sess?.feePerPerson ?? 0
    const cr = (m) => (fee ? Math.floor((m?.balance || 0) / fee) : 0)
    const base = (m) => ({ name: m?.name || '', photoURL: m?.photoURL || '', mobile: m?.mobile || '' })
    const res = await checkInMember(code, 'desk', sess)
    feedback(res.ok)
    if (res.ok) logScanEvent({ gate: 'desk', ok: true, kind: res.reason === 'reentry' ? 'reentry' : 'welcome', ...base(res.member), credits: res.sessionsLeft ?? cr(res.member) })
    else if (res.reason === 'already') logScanEvent({ gate: 'desk', ok: true, kind: 'already', ...base(res.member), credits: cr(res.member) })
    else if (res.reason === 'insufficient') logScanEvent({ gate: 'desk', ok: false, kind: 'low', ...base(res.member), credits: 0 })
    else if (res.reason === 'nosession') logScanEvent({ gate: 'desk', ok: false, kind: 'nosession', name: '', photoURL: '', mobile: '', credits: 0 })
    else logScanEvent({ gate: 'desk', ok: false, kind: 'notreg', name: '', photoURL: '', mobile: '', credits: 0 })
  }
  useCardWedge(onScan, control) // QR gun / keyboard-mode reader
  useLocalReader(control ? onScan : () => {}) // ACR122U via the bridge

  const checkedIn = useMemo(() => bookings.filter((b) => b.status === 'checked_in'), [bookings])
  const insideNow = checkedIn.filter((b) => !b.exitedAt).reduce((n, b) => n + (b.peopleCount || 0), 0)
  const today = checkedIn.reduce((n, b) => n + (b.peopleCount || 0), 0)

  const shown = useMemo(
    () => (gateFilter ? events.filter((e) => e.gate === gateFilter) : events),
    [events, gateFilter],
  )

  const lineFor = {
    welcome: 'Entered',
    reentry: 'Welcome back',
    already: 'Already inside',
    low: 'Low credit → recharge at desk',
    notreg: 'Unknown card → desk',
    nosession: 'No session running',
  }

  async function start() { setBusy(true); try { await startSession() } finally { setBusy(false) } }
  async function stop() {
    if (!session || !window.confirm('End the session? The live count resets for next time.')) return
    setBusy(true); try { await endSession(session.id) } finally { setBusy(false) }
  }

  return (
    <div className="gfeed">
      <header className="gfeed-top">
        <div>
          <div className="gfeed-title">🌿 Live Board{gateFilter ? ` · ${gateFilter.replace('gate', 'Door ')}` : ''}</div>
          <div className="gfeed-sub">{session ? '🟢 Session live' : '⏳ No active session'}</div>
        </div>
        <div className="gfeed-stats">
          <div className="gfeed-count"><b>{insideNow}</b><span>inside</span></div>
          <div className="gfeed-count"><b>{today}</b><span>today</span></div>
          {control && (
            <div className="gfeed-ctrl">
              {session
                ? <button className="btn danger small" onClick={stop} disabled={busy}>End session</button>
                : <button className="btn primary small" onClick={start} disabled={busy}>{busy ? '…' : 'Start session'}</button>}
              <Link className="btn ghost small" to="/admin/credits">💰 Reception</Link>
              <Link className="btn ghost small" to="/admin/command">📊 Analytics</Link>
            </div>
          )}
        </div>
      </header>

      {control && !session && (
        <div className="gfeed-startbanner">Start the session to open the doors. Members can’t check in until then.</div>
      )}

      <div className="gfeed-list">
        {shown.length === 0 && (
          <div className="gfeed-empty">Entries appear here live the moment someone scans or taps at a door.</div>
        )}
        {shown.map((e) => (
          <div key={e.id} className={`gfeed-row ${e.ok ? 'ok' : 'err'}`}>
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
              <span className={`gfeed-cr ${e.ok ? '' : 'low'}`}>{e.ok ? `${e.credits ?? 0} cr` : `0 cr`}</span>
              <span className="gfeed-time">{(e.gate || '').replace('gate', 'D')} · {fmtTime(e.at)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function fmtTime(ts) {
  if (!ts?.seconds) return 'now'
  return new Date(ts.seconds * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
