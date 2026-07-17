import { useEffect, useMemo, useState } from 'react'
import {
  subscribeActiveSession,
  subscribeSessionBookings,
  subscribeScanEvents,
} from '../lib/db'
import { useWakeLock } from '../lib/wakeLock'

// Door staff's handheld view (the two tablets). Streams every gate tap the
// Station PC processes: green tick = let them in, red cross = send to desk.
// Optional ?gate=gate1 filters to one door.
export default function GateFeed() {
  const gateFilter = new URLSearchParams(window.location.search).get('gate') || ''
  const [events, setEvents] = useState([])
  const [session, setSession] = useState(null)
  const [bookings, setBookings] = useState([])

  useWakeLock(true)
  useEffect(() => subscribeScanEvents(setEvents, 40), [])
  useEffect(() => subscribeActiveSession(setSession), [])
  useEffect(() => (session ? subscribeSessionBookings(session.id, setBookings) : undefined), [session])

  const insideNow = useMemo(
    () => bookings.filter((b) => b.status === 'checked_in' && !b.exitedAt).reduce((n, b) => n + (b.peopleCount || 0), 0),
    [bookings],
  )

  const shown = useMemo(
    () => (gateFilter ? events.filter((e) => e.gate === gateFilter) : events),
    [events, gateFilter],
  )

  const lineFor = {
    welcome: 'Checked in',
    reentry: 'Welcome back',
    already: 'Already inside',
    low: 'Low balance → desk',
    notreg: 'Unknown card → desk',
    nosession: 'No session running',
  }

  return (
    <div className="gfeed">
      <header className="gfeed-top">
        <div>
          <div className="gfeed-title">🌿 Gate Feed{gateFilter ? ` · ${gateFilter.replace('gate', 'Door ')}` : ''}</div>
          <div className="gfeed-sub">{session ? 'Session live' : '⏳ No active session'}</div>
        </div>
        <div className="gfeed-count"><b>{insideNow}</b><span>inside</span></div>
      </header>

      <div className="gfeed-list">
        {shown.length === 0 && (
          <div className="gfeed-empty">Taps will appear here the moment someone touches a door reader.</div>
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
              <span className={`gfeed-cr ${e.ok ? '' : 'low'}`}>{e.ok ? `${e.credits ?? 0} cr` : '0 cr'}</span>
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
