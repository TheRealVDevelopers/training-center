import { useState } from 'react'
import { createUserWithEmailAndPassword, signInWithEmailAndPassword } from 'firebase/auth'
import { Link, useNavigate } from 'react-router-dom'
import { auth } from '../firebase'
import { TIERS } from '../config'
import { createMemberProfile, uploadPhoto, updateMemberProfile, getMember } from '../lib/db'

export default function Signup() {
  const [form, setForm] = useState({ name: '', mobile: '', email: '', password: '', clubName: '', city: '', tier: 'Associate' })
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

  // Photo is best-effort AFTER the profile exists — an upload problem can
  // never block registration or orphan the account.
  async function attachPhoto(uid) {
    if (!photo) return
    try {
      const photoURL = await uploadPhoto(`members/${uid}/profile.jpg`, photo)
      await updateMemberProfile(uid, { photoURL })
    } catch { /* photo optional */ }
  }

  async function submit(e) {
    e.preventDefault()
    setErr('')
    setBusy(true)
    const email = form.email.trim()
    try {
      const cred = await createUserWithEmailAndPassword(auth, email, form.password)
      await createMemberProfile(cred.user.uid, { ...form, email })
      await attachPhoto(cred.user.uid)
      nav('/')
    } catch (er) {
      // Orphan recovery: account exists but the profile never got written.
      if (er.code === 'auth/email-already-in-use') {
        try {
          const cred = await signInWithEmailAndPassword(auth, email, form.password)
          if (!(await getMember(cred.user.uid))) {
            await createMemberProfile(cred.user.uid, { ...form, email })
            await attachPhoto(cred.user.uid)
          }
          nav('/')
          return
        } catch {
          setErr('This email is already registered — please log in instead.')
        }
      } else {
        setErr(er.message)
      }
      setBusy(false)
    }
  }

  return (
    <div className="center">
      <form className="card narrow signup" onSubmit={submit}>
        <div className="signup-hero">
          <div className="brand"><span className="leaf">🌿</span>Saturday Training</div>
          <h2>Create your profile</h2>
          <p className="muted small">One time — then just walk in and tap.</p>
        </div>

        <label className="avatar-upload" title="Add your photo">
          <input type="file" accept="image/*" onChange={onPhoto} style={{ display: 'none' }} />
          {preview ? <img src={preview} alt="" /> : <span className="avatar-upload-ph">📷<span>Add / upload photo</span></span>}
        </label>

        <label>Full name *</label>
        <input value={form.name} onChange={set('name')} required />

        <label>Level *</label>
        <select value={form.tier} onChange={set('tier')}>
          {Object.keys(TIERS).map((t) => <option key={t} value={t}>{t}</option>)}
        </select>

        <label>Club name</label>
        <input value={form.clubName} onChange={set('clubName')} placeholder="Your nutrition club" />

        <label>City</label>
        <input value={form.city} onChange={set('city')} placeholder="Your city" />

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
