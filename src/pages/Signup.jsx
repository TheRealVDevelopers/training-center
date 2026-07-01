import { useState } from 'react'
import { createUserWithEmailAndPassword } from 'firebase/auth'
import { Link, useNavigate } from 'react-router-dom'
import { auth } from '../firebase'
import { createMemberProfile, uploadPhoto } from '../lib/db'

export default function Signup() {
  const [form, setForm] = useState({ name: '', mobile: '', email: '', password: '', info: '' })
  const [photo, setPhoto] = useState(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const nav = useNavigate()

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  async function submit(e) {
    e.preventDefault()
    setErr('')
    setBusy(true)
    try {
      const cred = await createUserWithEmailAndPassword(auth, form.email.trim(), form.password)
      let photoURL = ''
      if (photo) photoURL = await uploadPhoto(`members/${cred.user.uid}/profile.jpg`, photo)
      await createMemberProfile(cred.user.uid, { ...form, email: form.email.trim(), photoURL })
      nav('/') // logged in directly after signup
    } catch (e) {
      setErr(e.message)
      setBusy(false)
    }
  }

  return (
    <div className="center">
      <form className="card narrow" onSubmit={submit}>
        <h2>Create your account</h2>
        <p className="muted">One time — then you just book and show your QR.</p>

        <label>Name *</label>
        <input value={form.name} onChange={set('name')} required />

        <label>Mobile number *</label>
        <input value={form.mobile} onChange={set('mobile')} inputMode="tel" required />

        <label>Email *</label>
        <input type="email" value={form.email} onChange={set('email')} required />

        <label>Password *</label>
        <input type="password" value={form.password} onChange={set('password')} minLength={6} required />

        <label>Basic info (optional)</label>
        <input value={form.info} onChange={set('info')} placeholder="e.g. area, referred by…" />

        <label>Profile photo</label>
        <input
          type="file"
          accept="image/*"
          capture="user"
          onChange={(e) => setPhoto(e.target.files?.[0] || null)}
        />
        {photo && <div className="muted small">Selected: {photo.name}</div>}

        {err && <div className="error">{err}</div>}

        <button className="btn primary block" disabled={busy}>
          {busy ? 'Creating…' : 'Create account'}
        </button>
        <p className="muted center-text">
          Already have an account? <Link to="/login">Log in</Link>
        </p>
      </form>
    </div>
  )
}
