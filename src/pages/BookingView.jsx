import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { QRCodeSVG } from 'qrcode.react'
import { CURRENCY } from '../config'
import { subscribeBooking, cancelBooking } from '../lib/db'

export default function BookingView() {
  const { id } = useParams()
  const nav = useNavigate()
  const [booking, setBooking] = useState(undefined) // undefined = loading
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => subscribeBooking(id, setBooking), [id])

  if (booking === undefined) return <div className="center muted">Loading booking…</div>
  if (booking === null) return <div className="center muted">Booking not found.</div>

  async function cancel() {
    setErr('')
    setBusy(true)
    try {
      await cancelBooking(id)
      nav('/')
    } catch (e) {
      setErr(e.message)
      setBusy(false)
    }
  }

  return (
    <div className="page">
      <button className="btn ghost small" onClick={() => nav('/')}>‹ Back</button>

      <div className="card center-text">
        <StatusTag status={booking.status} />
        <h3>{booking.peopleCount} {booking.peopleCount > 1 ? 'people' : 'person'}</h3>

        {booking.status === 'pending' ? (
          <>
            <div className="qrwrap">
              <QRCodeSVG value={booking.qrToken} size={240} level="M" includeMargin />
            </div>
            <p className="muted small">Show this at the gate. It stays active until it’s scanned.</p>
          </>
        ) : (
          <p className="muted">
            {booking.status === 'checked_in' ? '✓ Entered — this QR is now used.' : 'This booking was cancelled.'}
          </p>
        )}

        <div className="people">
          {booking.people.map((p, i) => (
            <div key={i} className="person">
              {p.photoURL ? <img src={p.photoURL} alt="" /> : <div className="avatar-fallback">{(p.name || '?')[0]}</div>}
              <span>{p.name}{p.isGuest ? ' (guest)' : ''}</span>
            </div>
          ))}
        </div>

        <div className="muted small">Total at check-in: {CURRENCY}{booking.totalAmount}</div>
        {err && <div className="error">{err}</div>}

        {booking.status === 'pending' && (
          <button className="btn danger block" onClick={cancel} disabled={busy}>
            {busy ? 'Cancelling…' : 'Cancel booking'}
          </button>
        )}
      </div>
    </div>
  )
}

function StatusTag({ status }) {
  const map = {
    pending: ['tag pending', 'Active'],
    checked_in: ['tag ok', 'Checked in'],
    cancelled: ['tag muted', 'Cancelled'],
  }
  const [cls, label] = map[status] || ['tag muted', status]
  return <span className={cls}>{label}</span>
}
