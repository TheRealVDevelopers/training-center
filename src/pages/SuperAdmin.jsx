import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { CURRENCY } from '../config'
import {
  subscribeAccessCodes,
  setAccessCode,
  subscribeActiveSession,
  subscribeSessionBookings,
} from '../lib/db'
import { generateCode } from '../lib/access'

// Open access — /super loads the panel directly with no login.
export default function SuperAdmin() {
  const { user, logout } = useAuth()
  return <Panel logout={user ? logout : null} />
}

function Panel({ logout }) {
  const [codes, setCodes] = useState({})
  const [session, setSession] = useState(null)
  const [bookings, setBookings] = useState([])
  useEffect(() => subscribeAccessCodes(setCodes), [])
  useEffect(() => subscribeActiveSession(setSession), [])
  useEffect(() => (session ? subscribeSessionBookings(session.id, setBookings) : undefined), [session])

  const checkedIn = bookings.filter((b) => b.status === 'checked_in')
  const attendees = checkedIn.reduce((n, b) => n + (b.peopleCount || 0), 0)
  const inside = checkedIn.filter((b) => !b.exitedAt).reduce((n, b) => n + (b.peopleCount || 0), 0)
  const revenue = checkedIn.reduce((n, b) => n + (b.totalAmount || 0), 0)

  return (
    <div className="page">
      <header className="topbar">
        <div>
          <div className="brand"><span className="leaf">🌿</span> Super Admin</div>
          <div className="muted small">Owner control hub</div>
        </div>
        {logout && <button className="btn ghost small" onClick={logout}>Log out</button>}
      </header>

      {/* Today at a glance */}
      {session ? (
        <>
          <div className="row between" style={{ margin: '4px 2px 10px' }}>
            <span className="live-pill"><span className="live-dot" />SESSION LIVE</span>
            <Link className="btn ghost small" to="/admin">Open Reception ›</Link>
          </div>
          <section className="mstats">
            <div className="mstat"><div className="mstat-val">{inside}</div><div className="mstat-lbl">Inside now</div></div>
            <div className="mstat"><div className="mstat-val">{attendees}</div><div className="mstat-lbl">Total today</div></div>
            <div className="mstat"><div className="mstat-val">{CURRENCY}{revenue}</div><div className="mstat-lbl">Revenue</div></div>
          </section>
        </>
      ) : (
        <div className="banner">No session running. Start one from <Link to="/admin">Reception</Link>.</div>
      )}

      {/* Stations — one tap to open any screen */}
      <h3 className="section-h">Stations</h3>
      <div className="stations-grid">
        <Link className="station-tile" to="/admin">
          <span className="station-ico">🖥️</span>
          <span className="station-t">Reception</span>
          <span className="station-s">Main screen · live entries · recharge · session control</span>
        </Link>
        <Link className="station-tile" to="/admin/credits">
          <span className="station-ico">💰</span>
          <span className="station-t">Credits &amp; cards</span>
          <span className="station-s">Recharge · assign / write member cards</span>
        </Link>
        <Link className="station-tile" to="/door" target="_blank">
          <span className="station-ico">🚪</span>
          <span className="station-t">Door screen</span>
          <span className="station-s">QR sign — scan to watch entries on a phone</span>
        </Link>
        <Link className="station-tile" to="/admin/command">
          <span className="station-ico">📊</span>
          <span className="station-t">Analytics</span>
          <span className="station-s">Detailed Command Center (owner)</span>
        </Link>
        <Link className="station-tile" to="/admin/report">
          <span className="station-ico">🧾</span>
          <span className="station-t">Daily report</span>
          <span className="station-s">Attendance · cash reconciliation</span>
        </Link>
        <Link className="station-tile" to="/admin/print" target="_blank">
          <span className="station-ico">🖨️</span>
          <span className="station-t">Card Studio</span>
          <span className="station-s">Print member cards by level</span>
        </Link>
        <Link className="station-tile" to="/">
          <span className="station-ico">🌿</span>
          <span className="station-t">Member view</span>
          <span className="station-s">What members see</span>
        </Link>
        <Link className="station-tile" to="/signup" target="_blank">
          <span className="station-ico">📝</span>
          <span className="station-t">Signup page</span>
          <span className="station-s">Share for new registrations</span>
        </Link>
      </div>
      <p className="muted small" style={{ margin: '2px 4px 8px' }}>
        You open these without a code. Staff unlock them with the codes below.
      </p>

      {/* Access codes */}
      <h3 className="section-h">Staff access codes</h3>
      <div className="codes-grid">
        <CodeRow title="Admin code" subtitle="desk staff · dashboard & credits" value={codes.adminCode} onSet={(c) => setAccessCode('adminCode', c)} />
        <CodeRow title="Door code" subtitle="door staff · door QR + live board" value={codes.scannerCode} onSet={(c) => setAccessCode('scannerCode', c)} />
        <CodeRow title="Card Write PIN" subtitle="required to assign / write a card" value={codes.writeCode} onSet={(c) => setAccessCode('writeCode', c)} />
      </div>
      <p className="muted small" style={{ margin: '2px 4px' }}>
        Share the code — staff type it once on their device, no account needed. Regenerate to instantly lock out every device using the old code.
      </p>
    </div>
  )
}

function CodeRow({ title, subtitle, value, onSet }) {
  const [custom, setCustom] = useState('')
  return (
    <div className="card codecard">
      <div className="row between">
        <div>
          <div className="strong">{title}</div>
          <div className="muted small">{subtitle}</div>
        </div>
        <button className="btn" onClick={() => onSet(generateCode())}>Regenerate</button>
      </div>
      <div className="codeval">{value || '— not set —'}</div>
      <div className="row gap">
        <input
          inputMode="numeric"
          maxLength={6}
          placeholder="set a custom 6-digit"
          value={custom}
          onChange={(e) => setCustom(e.target.value.replace(/\D/g, ''))}
        />
        <button className="btn" disabled={custom.length !== 6} onClick={() => { onSet(custom); setCustom('') }}>
          Save
        </button>
      </div>
    </div>
  )
}
