import { useState } from 'react'
import { createUserWithEmailAndPassword, signInWithEmailAndPassword } from 'firebase/auth'
import { Link, useNavigate } from 'react-router-dom'
import { auth } from '../firebase'
import { createMemberProfile, uploadPhoto, updateMemberProfile, getMember } from '../lib/db'

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

  // Upload the photo AFTER the profile exists, best-effort — a Storage hiccup
  // must never block registration or leave an account without a profile.
  async function attachPhoto(uid) {
    if (!photo) return
    try {
      const photoURL = await uploadPhoto(`members/${uid}/profile.jpg`, photo)
      await updateMemberProfile(uid, { photoURL })
    } catch {
      /* photo is optional — ignore and keep the account */
    }
  }

  async function submit(e) {
    e.preventDefault()
    setErr('')
    setBusy(true)
    const email = form.email.trim()
    try {
      const cred = await createUserWithEmailAndPassword(auth, email, form.password)
      // Profile FIRST so the account can never be orphaned; photo is best-effort.
      await createMemberProfile(cred.user.uid, { ...form, email, photoURL: '' })
      await attachPhoto(cred.user.uid)
      nav('/')
    } catch (e) {
      // Recover an orphaned account: the email exists but signup failed before
      // the profile was written. If the password matches, sign in and finish.
      if (e.code === 'auth/email-already-in-use') {
        try {
          const cred = await signInWithEmailAndPassword(auth, email, form.password)
          const existing = await getMember(cred.user.uid)
          if (!existing) {
            await createMemberProfile(cred.user.uid, { ...form, email, photoURL: '' })
            await attachPhoto(cred.user.uid)
          }
          nav('/')
          return
        } catch {
          setErr('This email is already registered. Please log in instead.')
        }
      } else {
        setErr(e.message)
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
          <p className="muted small">Join the community — one-time signup.</p>
        </div>

        <label className="avatar-upload" title="Add your photo">
          {/* No `capture` attribute → the OS picker offers BOTH "Take photo" and
              "Choose from gallery/files", instead of forcing the camera open. */}
          <input type="file" accept="image/*" onChange={onPhoto} style={{ display: 'none' }} />
          {preview
            ? <img src={preview} alt="" />
            : <span className="avatar-upload-ph">📷<span>Add / upload photo</span></span>}
        </label>
        {preview && (
          <button type="button" className="btn ghost small" style={{ margin: '0 auto 4px', display: 'block' }} onClick={() => { setPhoto(null); setPreview('') }}>
            Remove photo
          </button>
        )}

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
