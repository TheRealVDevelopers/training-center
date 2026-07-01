import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { signInWithEmailAndPassword } from 'firebase/auth'
import { auth } from '../firebase'
import { useAuth } from '../auth/AuthContext'
import { subscribeAccessCodes, setAccessCode } from '../lib/db'
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
  useEffect(() => subscribeAccessCodes(setCodes), [])

  return (
    <div className="page">
      <header className="topbar">
        <div className="brand"><span className="leaf">🌿</span> Super Admin</div>
        <button className="btn ghost small" onClick={logout}>Log out</button>
      </header>

      <p className="muted">
        Generate the access codes, then share them: the <strong>admin code</strong> with desk staff, the{' '}
        <strong>scanner code</strong> with door volunteers. They just type the code on their phone — no account
        needed. Regenerate any time to instantly lock out everyone using the old code.
      </p>

      <CodeRow title="Admin page code" subtitle="for the live dashboard & credits" value={codes.adminCode} onSet={(c) => setAccessCode('adminCode', c)} />
      <CodeRow title="Scanner page code" subtitle="for door volunteers at /scan" value={codes.scannerCode} onSet={(c) => setAccessCode('scannerCode', c)} />

      <div className="card">
        <h3>Open</h3>
        <div className="actions">
          <Link className="btn big" to="/admin">Admin dashboard ›</Link>
          <Link className="btn big" to="/admin/credits">Credits &amp; balances ›</Link>
          <Link className="btn big" to="/scan?gate=1" target="_blank">Scanner ›</Link>
          <Link className="btn big" to="/">Member view ›</Link>
        </div>
        <p className="muted small" style={{ marginTop: 10 }}>
          As the owner you’re let into these without typing a code.
        </p>
      </div>
    </div>
  )
}

function CodeRow({ title, subtitle, value, onSet }) {
  const [custom, setCustom] = useState('')
  return (
    <div className="card">
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
