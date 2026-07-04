import { useState } from 'react'
import { createUserWithEmailAndPassword } from 'firebase/auth'
import { Link, useNavigate } from 'react-router-dom'
import { auth } from '../firebase'
import { createMemberProfile, uploadPhoto } from '../lib/db'

export default function Signup() {
  const [form, setForm] = useState({
    name: '', mobile: '', email: '', password: '',
    position: '', clubName: '', years: '', city: '',
  })
  const [photo, setPhoto] = useState(null)
  const [preview, setPreview] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const nav = useNavigate()

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  function onPhoto(e) {
    const f = e.target.files?.[0] || null
    setPhoto(f)
    setPreview(f ? URL.createObjectURL(f) : '')
  }

  async function submit(e) {
    e.preventDefault()
    setErr('')
    setBusy(true)
    try {
      const cred = await createUserWithEmailAndPassword(auth, form.email.trim(), form.password)
      let photoURL = ''
      if (photo) photoURL = await uploadPhoto(`members/${cred.user.uid}/profile.jpg`, photo)
      await createMemberProfile(cred.user.uid, { ...form, email: form.email.trim(), photoURL })
      nav('/')
    } catch (e) {
      setErr(e.message)
      setBusy(false)
    }
  }

  return (
    <div className="center">
      <form className="card narrow signup" onSubmit={submit}>
        <div className="signup-hero">
          <div className="brand"><span className="leaf">🌿</span>Saturday Training</div>
          <h2>Create your profile</h2>
          <p className="muted small">Join the community — one-time signup.</p>
        </div>

        <label className="avatar-upload" title="Add your photo">
          <input type="file" accept="image/*" capture="user" onChange={onPhoto} style={{ display: 'none' }} />
          {preview
            ? <img src={preview} alt="" />
            : <span className="avatar-upload-ph">📷<span>Add photo</span></span>}
        </label>

        <label>Full name *</label>
        <input value={form.name} onChange={set('name')} required />

        <label>Position / Level</label>
        <input value={form.position} onChange={set('position')} placeholder="e.g. President's Team · Millionaire · GET" />

        <label>Club name</label>
        <input value={form.clubName} onChange={set('clubName')} placeholder="Your club name" />

        <div className="signup-row">
          <div>
            <label>Years with Herbalife</label>
            <input value={form.years} onChange={set('years')} inputMode="numeric" placeholder="e.g. 5" />
          </div>
          <div>
            <label>City</label>
            <input value={form.city} onChange={set('city')} placeholder="Your city" />
          </div>
        </div>

        <label>Mobile number *</label>
        <input value={form.mobile} onChange={set('mobile')} inputMode="tel" required />

        <label>Email *</label>
        <input type="email" value={form.email} onChange={set('email')} required />

        <label>Password *</label>
        <input type="password" value={form.password} onChange={set('password')} minLength={6} required />

        {err && <div className="error">{err}</div>}

        <button className="btn primary block" disabled={busy}>
          {busy ? 'Creating…' : 'Create my account'}
        </button>
        <p className="muted small center-text" style={{ marginTop: 12 }}>
          Already registered? <Link to="/login">Log in</Link>
        </p>
      </form>
    </div>
  )
}
