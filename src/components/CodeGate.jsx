import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { subscribeAccessCodes } from '../lib/db'
import { rememberAccess, getRemembered } from '../lib/access'

// Wraps a page (admin / scanner) behind a 6-digit code.
//  - The super admin (owner) bypasses the code entirely.
//  - A device that enters the right code is remembered until the owner
//    regenerates it (then the stored code stops matching → locked out).
// kind: 'admin' | 'scanner'
export default function CodeGate({ kind, label, children }) {
  const { isSuper, loading } = useAuth()
  const [codes, setCodes] = useState(undefined)
  const [entered, setEntered] = useState(() => getRemembered(kind))
  const [input, setInput] = useState('')
  const [err, setErr] = useState('')

  useEffect(() => subscribeAccessCodes(setCodes), [])

  if (loading || codes === undefined) return <div className="center muted">Loading…</div>
  if (isSuper) return children

  const required = kind === 'admin' ? codes.adminCode : codes.scannerCode
  if (required && entered === required) return children

  function submit(e) {
    e.preventDefault()
    setErr('')
    if (!required) {
      setErr('No code has been set yet. Ask the owner.')
      return
    }
    if (input.trim() === required) {
      rememberAccess(kind, input.trim())
      setEntered(input.trim())
    } else {
      setErr('Incorrect code.')
      setInput('')
    }
  }

  return (
    <div className="center">
      <form className="card narrow center-text" onSubmit={submit}>
        <div className="brand"><span className="leaf">🌿</span> {label || 'Restricted area'}</div>
        <p className="muted">Enter the 6-digit access code.</p>
        <input
          className="code-input"
          inputMode="numeric"
          maxLength={6}
          autoFocus
          placeholder="••••••"
          value={input}
          onChange={(e) => setInput(e.target.value.replace(/\D/g, ''))}
        />
        {err && <div className="error">{err}</div>}
        {!required && (
          <div className="muted small">The owner must set a code in Super Admin first.</div>
        )}
        <button className="btn primary block" type="submit" disabled={input.length !== 6}>
          Unlock
        </button>
        <p className="muted small center-text" style={{ marginTop: 14 }}>
          Owner? <Link to="/super">Go to Super Admin</Link>
        </p>
      </form>
    </div>
  )
}
