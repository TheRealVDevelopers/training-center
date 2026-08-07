import { useEffect, useState } from 'react'
import { signInAnonymously } from 'firebase/auth'
import { auth } from '../firebase'
import { useAuth } from '../auth/AuthContext'
import { OWNER_PASSWORD } from '../pages/Owner'

// Guard for the report pages (member history, money, attendance). It uses the
// SAME shared owner password as /owner — unlocked once per device — so opening
// a report from the Owner page never asks again. The owner's email login, if
// signed in, walks straight through.
export default function OwnerOnly({ children }) {
  const { user, loading, isSuper } = useAuth()
  const [ok, setOk] = useState(() => localStorage.getItem('owner_pass') === OWNER_PASSWORD)
  const [input, setInput] = useState('')
  const [err, setErr] = useState('')

  // The device needs a silent identity so the database accepts its reads.
  useEffect(() => {
    if (loading || user) return
    signInAnonymously(auth).catch(() => {})
  }, [loading, user])

  if (loading || !user) return <div className="center muted">Loading…</div>
  if (isSuper || ok) return children

  function submit(e) {
    e.preventDefault()
    if (input.trim().toUpperCase() === OWNER_PASSWORD) {
      localStorage.setItem('owner_pass', OWNER_PASSWORD)
      setOk(true)
    } else {
      setErr('Wrong password.')
      setInput('')
    }
  }

  return (
    <div className="center">
      <form className="card narrow center-text" onSubmit={submit}>
        <div className="brand"><span className="leaf">🌿</span> Owner</div>
        <p className="muted">This page shows member history and money. Enter the owner password — this device will remember it.</p>
        <input
          type="password" autoFocus placeholder="Password" value={input}
          onChange={(e) => { setErr(''); setInput(e.target.value) }}
        />
        {err && <div className="error">{err}</div>}
        <button className="btn primary block" type="submit" disabled={!input.trim()}>Open</button>
      </form>
    </div>
  )
}

// Shared helper: a WhatsApp deep link for an Indian mobile number.
export function waLink(mobile, text) {
  const digits = String(mobile || '').replace(/\D/g, '')
  if (digits.length < 10) return null
  const withCode = digits.length === 10 ? `91${digits}` : digits.replace(/^0+/, '')
  return `https://wa.me/${withCode}?text=${encodeURIComponent(text)}`
}
