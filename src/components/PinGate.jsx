import { useEffect, useState } from 'react'
import { signInAnonymously } from 'firebase/auth'
import { auth } from '../firebase'
import { useAuth } from '../auth/AuthContext'
import { subscribeSettings } from '../lib/db'

// The one staff gate. A device types the 4-digit PIN ONCE and is remembered
// until the owner changes the PIN. The owner (email login) never sees it.
// Under the hood the device signs in anonymously so the locked database
// rules let it work — invisible to the user.
export default function PinGate({ label, children }) {
  const { user, isSuper, loading } = useAuth()
  const [settings, setSettings] = useState(undefined)
  const [entered, setEntered] = useState(() => localStorage.getItem('staff_pin') || '')
  const [input, setInput] = useState('')
  const [err, setErr] = useState('')

  // Give the device a silent identity so the database accepts it.
  useEffect(() => {
    if (loading || user) return
    signInAnonymously(auth).catch(() => {})
  }, [loading, user])

  useEffect(() => {
    if (loading || !user) return undefined
    return subscribeSettings(setSettings)
  }, [loading, user])

  if (loading || (user && settings === undefined)) return <div className="center muted">Loading…</div>
  if (isSuper) return children

  const pin = settings?.staffPin
  // No PIN set yet → open (the owner sets one from the Owner page when ready).
  if (!pin) return children
  if (entered === pin) return children

  function submit(e) {
    e.preventDefault()
    if (input === pin) {
      localStorage.setItem('staff_pin', input)
      setEntered(input)
    } else {
      setErr('Wrong PIN — ask the owner.')
      setInput('')
    }
  }

  return (
    <div className="center">
      <form className="card narrow center-text" onSubmit={submit}>
        <div className="brand"><span className="leaf">🌿</span> {label || 'Staff'}</div>
        <p className="muted">Enter the 4-digit staff PIN. This device will remember it.</p>
        <input
          className="code-input"
          inputMode="numeric"
          maxLength={4}
          autoFocus
          placeholder="••••"
          value={input}
          onChange={(e) => { setErr(''); setInput(e.target.value.replace(/\D/g, '')) }}
        />
        {err && <div className="error">{err}</div>}
        <button className="btn primary block" type="submit" disabled={input.length !== 4}>
          Unlock
        </button>
      </form>
    </div>
  )
}
