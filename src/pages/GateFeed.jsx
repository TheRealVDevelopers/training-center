import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  subscribeActiveSession,
  subscribeSessionBookings,
  subscribeScanEvents,
  startSession,
  endSession,
} from '../lib/db'
import { useWakeLock } from '../lib/wakeLock'

// The MAIN live board. Streams every tap: green ✓ = entered, red ✗ = low
// credit → send to desk. Shows name, mobile and credits left.
//  - control=true (at /admin): adds session start/stop + links (staff & owner).
//  - control=false (at /feed): view-only, for door staff phones. ?gate= filters.
export default function GateFeed({ control = false }) {
  const gateFilter = new URLSearchParams(window.location.search).get('gate') || ''
  const [events, setEvents] = useState([])
  const [session, setSession] = useState(null)
  const [bookings, setBookings] = useState([])
  const [busy, setBusy] = useState(false)

  useWakeLock(true)
  useEffect(() => subscribeScanEvents(setEvents, 50), [])
  useEffect(() => subscribeActiveSession(setSession), [])
  useEffect(() => (session ? subscribeSessionBookings(session.id, setBookings) : undefined), [session])

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
