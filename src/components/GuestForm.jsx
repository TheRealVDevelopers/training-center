import { useState } from 'react'

// Collects one guest. Photo is optional and can be uploaded OR captured with
// the camera (the `capture` attribute opens the rear camera on phones).
export default function GuestForm({ title, onSubmit, onCancel, busy }) {
  const [name, setName] = useState('')
  const [mobile, setMobile] = useState('')
  const [photo, setPhoto] = useState(null)

  function submit(e) {
    e.preventDefault()
    if (!name.trim()) return
    onSubmit({ name: name.trim(), mobile: mobile.trim(), photo })
  }

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <form className="modal card" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h3>{title || 'Guest details'}</h3>

        <label>Guest name *</label>
        <input value={name} onChange={(e) => setName(e.target.value)} autoFocus required />

        <label>Guest mobile</label>
        <input value={mobile} onChange={(e) => setMobile(e.target.value)} inputMode="tel" />

        <label>Guest photo (optional)</label>
        <input
          type="file"
          accept="image/*"
          capture="environment"
          onChange={(e) => setPhoto(e.target.files?.[0] || null)}
        />
        {photo && <div className="muted small">Selected: {photo.name}</div>}

        <div className="row gap" style={{ marginTop: 16 }}>
          <button type="button" className="btn ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={busy}>
            {busy ? 'Creating…' : 'Create booking'}
          </button>
        </div>
      </form>
    </div>
  )
}
