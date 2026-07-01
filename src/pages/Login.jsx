import { useState } from 'react'
import { signInWithEmailAndPassword } from 'firebase/auth'
import { Link, useNavigate } from 'react-router-dom'
import { auth } from '../firebase'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const nav = useNavigate()

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
      <form className="card narrow" onSubmit={submit}>
        <div className="brand" style={{ marginBottom: 12 }}><span className="leaf">🌿</span>Saturday Training</div>
        <p className="muted">Log in to your account</p>

        <label>Email</label>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />

        <label>Password</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />

        {err && <div className="error">{err}</div>}

        <button className="btn primary block" disabled={busy}>
          {busy ? 'Logging in…' : 'Log in'}
        </button>
        <p className="muted center-text">
          New here? <Link to="/signup">Create an account</Link>
        </p>
      </form>
    </div>
  )
}
