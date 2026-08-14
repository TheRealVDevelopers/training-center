import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { EmailAuthProvider, reauthenticateWithCredential, updatePassword } from 'firebase/auth'
import { auth } from '../firebase'
import { useAuth } from '../auth/AuthContext'
import { uploadPhoto, updateMemberProfile } from '../lib/db'
import { squarePhoto } from '../lib/photo'

// Member self-service: photo, contact details, password. The level (pricing)
// is set by the owner, not here.
export default function Profile() {
  const { user, member } = useAuth()
  const nav = useNavigate()

  const [name, setName] = useState(member?.name || '')
  const [mobile, setMobile] = useState(member?.mobile || '')
  const [clubName, setClubName] = useState(member?.clubName || '')
  const [city, setCity] = useState(member?.city || '')
  const [photo, setPhoto] = useState(null)
  const [saveMsg, setSaveMsg] = useState('')
  const [saving, setSaving] = useState(false)

  const [curPw, setCurPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [pwMsg, setPwMsg] = useState('')
  const [pwErr, setPwErr] = useState('')
  const [pwBusy, setPwBusy] = useState(false)

  if (!member) return <div className="center muted">Loading your profile…</div>

  async function saveProfile(e) {
    e.preventDefault()
    setSaveMsg('')
    setSaving(true)
    try {
      const data = { name: name.trim(), mobile: mobile.trim(), clubName: clubName.trim(), city: city.trim() }
      // Same square-crop + shrink as everywhere else, so the grids stay uniform.
      if (photo) data.photoURL = await uploadPhoto(`members/${member.id}/profile.jpg`, await squarePhoto(photo))
      await updateMemberProfile(member.id, data)
      setPhoto(null)
      setSaveMsg('Saved ✓')
    } catch (er) {
      setSaveMsg(er.message)
    } finally {
      setSaving(false)
    }
  }

  async function changePassword(e) {
    e.preventDefault()
    setPwMsg('')
    setPwErr('')
    if (newPw.length < 6) { setPwErr('New password must be at least 6 characters.'); return }
    setPwBusy(true)
    try {
      const cred = EmailAuthProvider.credential(user.email, curPw)
      await reauthenticateWithCredential(auth.currentUser, cred)
      await updatePassword(auth.currentUser, newPw)
      setCurPw(''); setNewPw('')
      setPwMsg('Password changed ✓')
    } catch (er) {
      setPwErr(er.code === 'auth/invalid-credential' || er.code === 'auth/wrong-password'
        ? 'Current password is incorrect.' : er.message)
    } finally {
      setPwBusy(false)
    }
  }

  return (
    <div className="page">
      <header className="topbar">
        <div className="brand"><span className="leaf">🌿</span>My Profile</div>
        <button className="btn ghost small" onClick={() => nav('/')}>‹ Back</button>
      </header>

      <form className="card" onSubmit={saveProfile}>
        <div className="profile-head">
          {member.photoURL
            ? <img className="profile-photo" src={member.photoURL} alt="" />
            : <span className="avatar-fallback">{(member.name || '?')[0]}</span>}
          <div>
            <div className="strong" style={{ fontSize: 17 }}>{member.name}</div>
            <div className="muted small">{user.email} · {member.tier || 'Member'}</div>
          </div>
        </div>

        <label>Name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} required />
        <label>Mobile number</label>
        <input value={mobile} onChange={(e) => setMobile(e.target.value)} inputMode="tel" required />
        <label>Club name</label>
        <input value={clubName} onChange={(e) => setClubName(e.target.value)} />
        <label>City</label>
        <input value={city} onChange={(e) => setCity(e.target.value)} />
        <label>Change photo (camera or gallery)</label>
        <input type="file" accept="image/*" onChange={(e) => setPhoto(e.target.files?.[0] || null)} />
        {photo && <div className="muted small">Selected: {photo.name}</div>}

        {saveMsg && <div className="banner">{saveMsg}</div>}
        <button className="btn primary block" disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button>
      </form>

      <form className="card" onSubmit={changePassword}>
        <h3>Change password</h3>
        <label>Current password</label>
        <input type="password" value={curPw} onChange={(e) => setCurPw(e.target.value)} required />
        <label>New password</label>
        <input type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} minLength={6} required />
        {pwErr && <div className="error">{pwErr}</div>}
        {pwMsg && <div className="banner">{pwMsg}</div>}
        <button className="btn block" disabled={pwBusy}>{pwBusy ? 'Updating…' : 'Update password'}</button>
      </form>
    </div>
  )
}
