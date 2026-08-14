import { useState } from 'react'
import { signInWithEmailAndPassword, sendPasswordResetEmail } from 'firebase/auth'
import { Link, useNavigate } from 'react-router-dom'
import { auth } from '../firebase'
import InstallApp from '../components/InstallApp'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const nav = useNavigate()

  async function forgot() {
    setErr('')
    setMsg('')
    if (!email.trim()) {
      setErr('Type your email above first, then tap "Forgot password".')
      return
    }
    try {
      await sendPasswordResetEmail(auth, email.trim())
      setMsg('Password reset link sent — check your email inbox (and spam).')
    } catch (e) {
      setErr(e.message)
    }
  }

  async function submit(e) {
    e.preventDefault()
    setErr('')
    setBusy(true)
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password)
      nav('/')
    } catch (e) {
      setErr(e.message)
      setBusy(false)
    }
  }

  return (
    <div className="center">
      <div className="narrow-stack">
        <InstallApp />
      <form className="card narrow" onSubmit={submit}>
        <div className="brand" style={{ marginBottom: 12 }}><span className="leaf">🌿</span>Saturday Training</div>
        <p className="muted">Log in to your account</p>

        <label>Email</label>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />

        <label>Password</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />

        {err && <div className="error">{err}</div>}
        {msg && <div className="banner">{msg}</div>}

        <button className="btn primary block" disabled={busy}>
          {busy ? 'Logging in…' : 'Log in'}
        </button>
        <p className="muted center-text">
          New here? <Link to="/signup">Create an account</Link>
        </p>
        <p className="muted small center-text">
          <a href="#forgot" onClick={(e) => { e.preventDefault(); forgot() }}>Forgot password?</a>
        </p>
      </form>
      </div>
    </div>
  )
}
