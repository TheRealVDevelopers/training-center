import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { CURRENCY } from '../config'
import { clearAccess } from '../lib/access'
import { chime, primeAudio } from '../lib/feedback'
import CountUp from '../components/CountUp'
import {
  subscribeActiveSession,
  subscribeSessionBookings,
  subscribeMembers,
  startSession,
  endSession,
} from '../lib/db'

export default function AdminDashboard() {
  const { logout, isSuper } = useAuth()
  const [session, setSession] = useState(null)
  const [bookings, setBookings] = useState([])
  const [members, setMembers] = useState([])
  const [busy, setBusy] = useState(false)
  const [muted, setMuted] = useState(() => localStorage.getItem('admin_mute') === '1')

  useEffect(() => subscribeActiveSession(setSession), [])
  useEffect(() => subscribeMembers(setMembers), [])
  useEffect(() => (session ? subscribeSessionBookings(session.id, setBookings) : undefined), [session])

  // Live feed: checked-in bookings, ordered by entry time (client-side sort).
  const checkedIn = useMemo(
    () =>
      bookings
        .filter((b) => b.status === 'checked_in')
        .sort((a, b) => (a.checkedInAt?.seconds || 0) - (b.checkedInAt?.seconds || 0)),
    [bookings],
  )

  const attendees = checkedIn.reduce((n, b) => n + (b.peopleCount || 0), 0)
  const capacity = session?.capacity ?? 0
  const remaining = Math.max(0, capacity - attendees)

  // Soft chime when a new entry appears (after the first load).
  const prevCount = useRef(null)
  useEffect(() => {
    const n = checkedIn.length
    if (prevCount.current === null) {
      prevCount.current = n
      return
    }
    if (n > prevCount.current && !muted) chime()
    prevCount.current = n
  }, [checkedIn.length, muted])
  useEffect(() => {
    const prime = () => primeAudio()
    window.addEventListener('pointerdown', prime, { once: true })
    return () => window.removeEventListener('pointerdown', prime)
  }, [])

  function toggleMute() {
    const v = !muted
    setMuted(v)
    localStorage.setItem('admin_mute', v ? '1' : '0')
  }

  async function start() {
    setBusy(true)
    try {
      await startSession()
    } finally {
      setBusy(false)
    }
  }

  async function handleEnd() {
    if (!session) return
    const ok = window.confirm(
      'End the current session?\n\nThis resets the live count and cancels any un-scanned bookings (members get their held balance back). Next Saturday starts fresh.',
    )
    if (!ok) return
    setBusy(true)
    try {
      await endSession(session.id)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page wide">
      <header className="topbar">
        <div className="brand"><span className="leaf">🌿</span>Admin · Saturday Training</div>
        <div className="row gap">
          {isSuper && <Link className="btn ghost small" to="/super">Super Admin</Link>}
          <Link className="btn ghost small" to="/admin/credits">Credits</Link>
          <Link className="btn ghost small" to="/scan?gate=1" target="_blank">Open scanner</Link>
          <button className="btn ghost small" onClick={toggleMute} title="Entry sound">{muted ? '🔕' : '🔔'}</button>
          {session && (
            <button className="btn danger small" onClick={handleEnd} disabled={busy}>
              End session
            </button>
          )}
          {isSuper ? (
            <button className="btn ghost small" onClick={logout}>Log out</button>
          ) : (
            <button className="btn ghost small" onClick={() => { clearAccess('admin'); window.location.reload() }}>
              Lock
            </button>
          )}
        </div>
      </header>

      {!session ? (
        <div className="card center-text">
          <p className="muted">No active session.</p>
          <button className="btn primary" onClick={start} disabled={busy}>
            {busy ? 'Starting…' : 'Start session'}
          </button>
        </div>
      ) : (
        <>
          <div className="stats">
            <Stat label="Registered members" value={members.length} />
            <Stat label="Attendees (live)" value={attendees} accent />
            <Stat label="Remaining seats" value={remaining} />
          </div>

          <div className="card">
            <div className="row between">
              <h3>Live entries</h3>
              <span className="muted small">updates in real time</span>
            </div>
            {checkedIn.length === 0 && (
              <div className="empty">
                <span className="ico">🚪</span>
                <div className="t">No one has entered yet</div>
                <div className="small">Entries appear here live as people are scanned in.</div>
              </div>
            )}
            <div className="feed-grid">
              {checkedIn.map((b, i) => (
                <div key={b.id} className="feed-card">
                  <div className="feed-card-top">
                    <span className="seq">{i + 1}</span>
                    <span className="muted small">−{CURRENCY}{b.totalAmount}</span>
                  </div>
                  <div className="feed-faces">
                    {b.people.map((p, j) =>
                      p.photoURL ? (
                        <img key={j} src={p.photoURL} alt="" />
                      ) : (
                        <div key={j} className="avatar-fallback sm">{(p.name || '?')[0]}</div>
                      ),
                    )}
                  </div>
                  <div>
                    <div className="feed-card-name">{b.memberName}</div>
                    <div className="muted small">
                      {b.peopleCount} {b.peopleCount > 1 ? 'people' : 'person'}
                      {b.gate ? ` · gate ${b.gate}` : ''}
                    </div>
                  </div>
                  <div className="feed-time">🕘 {fmtTime(b.checkedInAt)}</div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function Stat({ label, value, accent }) {
  return (
    <div className={`card stat ${accent ? 'accent' : ''}`}>
      <div className="statval"><CountUp value={value} /></div>
      <div className="muted small">{label}</div>
    </div>
  )
}

// Check-in time from a Firestore timestamp (null until an offline scan syncs).
function fmtTime(ts) {
  if (!ts?.seconds) return '⏳ syncing'
  return new Date(ts.seconds * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
