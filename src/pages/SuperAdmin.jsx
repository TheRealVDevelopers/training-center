import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { signInWithEmailAndPassword } from 'firebase/auth'
import { auth } from '../firebase'
import { useAuth } from '../auth/AuthContext'
import { CURRENCY } from '../config'
import {
  subscribeAccessCodes,
  setAccessCode,
  subscribeActiveSession,
  subscribeSessionBookings,
} from '../lib/db'
import { generateCode } from '../lib/access'

export default function SuperAdmin() {
  const { user, loading, logout, isSuper } = useAuth()

  if (loading) return <div className="center muted">Loading…</div>
  if (!user) return <SuperLogin />
  if (!isSuper) return <NotAuthorized onLogout={logout} email={user.email} />
  return <Panel logout={logout} />
}

function SuperLogin() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setErr('')
    setBusy(true)
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password)
    } catch (e) {
      setErr(e.message)
      setBusy(false)
    }
  }

  return (
    <div className="center">
      <form className="card narrow" onSubmit={submit}>
        <div className="brand"><span className="leaf">🌿</span> Super Admin</div>
        <p className="muted">Owner login only.</p>
        <label>Email</label>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <label>Password</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        {err && <div className="error">{err}</div>}
        <button className="btn primary block" disabled={busy}>{busy ? 'Logging in…' : 'Log in'}</button>
        <p className="muted small center-text" style={{ marginTop: 14 }}>
          First time? <Link to="/signup">Create your owner account</Link> with your email, then come back.
        </p>
      </form>
    </div>
  )
}

function NotAuthorized({ onLogout, email }) {
  return (
    <div className="center">
      <div className="card narrow center-text">
        <h3>Not authorized</h3>
        <p className="muted">This area is for the owner only. You’re signed in as {email}.</p>
        <button className="btn block" onClick={onLogout}>Log out</button>
      </div>
    </div>
  )
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
        <button className="btn ghost small" onClick={logout}>Log out</button>
      </header>

      {/* Today at a glance */}
      {session ? (
        <>
          <div className="row between" style={{ margin: '4px 2px 10px' }}>
            <span className="live-pill"><span className="live-dot" />SESSION LIVE</span>
            <Link className="btn ghost small" to="/admin">Open Command Center ›</Link>
          </div>
          <section className="mstats">
            <div className="mstat"><div className="mstat-val">{inside}</div><div className="mstat-lbl">Inside now</div></div>
            <div className="mstat"><div className="mstat-val">{attendees}</div><div className="mstat-lbl">Total today</div></div>
            <div className="mstat"><div className="mstat-val">{CURRENCY}{revenue}</div><div className="mstat-lbl">Revenue</div></div>
          </section>
        </>
      ) : (
        <div className="banner">No session running. Start one from the <Link to="/admin">Command Center</Link>.</div>
      )}

      {/* Stations — one tap to open any screen */}
      <h3 className="section-h">Stations</h3>
      <div className="stations-grid">
        <Link className="station-tile" to="/admin">
          <span className="station-ico">🖥️</span>
          <span className="station-t">Command Center</span>
          <span className="station-s">Live board · session control</span>
        </Link>
        <Link className="station-tile" to="/admin/credits">
          <span className="station-ico">💰</span>
          <span className="station-t">Reception · Credits</span>
          <span className="station-s">Recharge · assign cards</span>
        </Link>
        <Link className="station-tile" to="/admin/report">
          <span className="station-ico">📊</span>
          <span className="station-t">Daily report</span>
          <span className="station-s">Attendance · cash reconciliation</span>
        </Link>
        <Link className="station-tile" to="/admin/print" target="_blank">
          <span className="station-ico">🖨️</span>
          <span className="station-t">Card Studio</span>
          <span className="station-s">Print member cards by level</span>
        </Link>
        <Link className="station-tile" to="/station" target="_blank">
          <span className="station-ico">🎛️</span>
          <span className="station-t">Station Hub</span>
          <span className="station-s">Registration PC · both door readers</span>
        </Link>
        <Link className="station-tile" to="/feed" target="_blank">
          <span className="station-ico">📡</span>
          <span className="station-t">Gate Feed</span>
          <span className="station-s">Door tablets · live ✓/✗ stream</span>
        </Link>
        <Link className="station-tile" to="/door?gate=1" target="_blank">
          <span className="station-ico">🚪</span>
          <span className="station-t">Door 1</span>
          <span className="station-s">Tap-in screen (wall tablet)</span>
        </Link>
        <Link className="station-tile" to="/door?gate=2" target="_blank">
          <span className="station-ico">🚪</span>
          <span className="station-t">Door 2</span>
          <span className="station-s">Tap-in screen (wall tablet)</span>
        </Link>
        <Link className="station-tile" to="/card" target="_blank">
          <span className="station-ico">💳</span>
          <span className="station-t">Card scanner</span>
          <span className="station-s">Simple tap-to-enter screen</span>
        </Link>
        <Link className="station-tile" to="/scan?gate=1" target="_blank">
          <span className="station-ico">📷</span>
          <span className="station-t">QR scanner</span>
          <span className="station-s">Camera scanning at the door</span>
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
        <CodeRow title="Scanner code" subtitle="door staff · door / card / QR pages" value={codes.scannerCode} onSet={(c) => setAccessCode('scannerCode', c)} />
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
