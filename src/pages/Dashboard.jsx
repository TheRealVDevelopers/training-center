import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { CURRENCY, MAX_GUESTS_PER_SESSION } from '../config'
import GuestForm from '../components/GuestForm'
import CountUp from '../components/CountUp'
import { confetti } from '../lib/celebrate'
import {
  subscribeActiveSession,
  subscribeMemberBookings,
  subscribeTransactions,
  createBooking,
  uploadPhoto,
} from '../lib/db'

export default function Dashboard() {
  const { member, logout, isSuper } = useAuth()
  const nav = useNavigate()

  const [session, setSession] = useState(null)
  const [bookings, setBookings] = useState([])
  const [txns, setTxns] = useState([])
  const [guestMode, setGuestMode] = useState(null) // 'self_guest' | 'guest' | null
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => subscribeActiveSession(setSession), [])
  useEffect(() => (member ? subscribeMemberBookings(member.id, setBookings) : undefined), [member])
  useEffect(() => (member ? subscribeTransactions(member.id, setTxns) : undefined), [member])

  if (!member) return <div className="center muted">Loading your profile…</div>

  const fee = session?.feePerPerson ?? 0
  const balance = member.balance || 0
  const reserved = member.reserved || 0
  const available = balance - reserved // spendable: wallet minus active-booking holds
  const guestsBooked = bookings
    .filter((b) => b.sessionId === session?.id && b.status !== 'cancelled')
    .reduce((n, b) => n + (b.people?.filter((p) => p.isGuest).length || 0), 0)
  const guestsLeft = MAX_GUESTS_PER_SESSION - guestsBooked

  async function book(type, guest) {
    setErr('')
    if (type !== 'self' && guestsLeft < 1) {
      setErr(`Guest limit reached (max ${MAX_GUESTS_PER_SESSION} per session).`)
      return
    }
    setBusy(true)
    try {
      const people = []
      if (type !== 'guest') {
        people.push({ name: member.name, isGuest: false, photoURL: member.photoURL || '' })
      }
      if (guest) {
        let guestPhotoURL = ''
        if (guest.photo) {
          guestPhotoURL = await uploadPhoto(`guests/${member.id}/${Date.now()}.jpg`, guest.photo)
        }
        people.push({ name: guest.name, isGuest: true, mobile: guest.mobile, photoURL: guestPhotoURL })
      }
      const token = await createBooking({ member, session, type, people })
      setGuestMode(null)
      confetti()
      nav(`/booking/${token}`)
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  const pending = bookings.filter((b) => b.status === 'pending')

  return (
    <div className="page">
      <header className="topbar">
        <div>
          <div className="brand"><span className="leaf">🌿</span>Saturday Training</div>
          <div className="muted small">Training Registration</div>
        </div>
        <div className="row gap">
          {isSuper && <Link className="btn ghost small" to="/super">Super Admin</Link>}
          <button className="btn ghost small" onClick={logout}>Log out</button>
        </div>
      </header>

      {/* Balance + cost */}
      <div className="card hero">
        <div className="row between">
          <div>
            <div className="muted small">Current balance</div>
            <div className="balance">{CURRENCY}<CountUp value={balance} /></div>
          </div>
          <div className="right">
            <div className="muted small">Per-person fee</div>
            <div className="fee">{CURRENCY}{fee}</div>
            <div className="muted small">deducted at check-in</div>
          </div>
        </div>
        {reserved > 0 && (
          <div className="row between" style={{ marginTop: 10 }}>
            <span className="muted small">On hold ({CURRENCY}{reserved}) · Available to book</span>
            <span className="strong">{CURRENCY}{available}</span>
          </div>
        )}
        <BalancePreview balance={balance} fee={fee} />
      </div>

      {!session && (
        <div className="banner warn">No active session right now. Ask the admin to start one.</div>
      )}
      {err && <div className="error">{err}</div>}

      {/* Three booking actions */}
      <div className="actions">
        <button className="action-card primary" disabled={!session || busy || available < fee} onClick={() => book('self')}>
          <span className="action-ico">🙋</span>
          <span className="action-body">
            <span className="action-title">Book a Slot for Myself</span>
            <span className="action-sub">{CURRENCY}{fee} · 1 person</span>
          </span>
          <span className="chev">›</span>
        </button>
        <button className="action-card" disabled={!session || busy || available < fee * 2 || guestsLeft < 1} onClick={() => setGuestMode('self_guest')}>
          <span className="action-ico">👥</span>
          <span className="action-body">
            <span className="action-title">Myself + Guest</span>
            <span className="action-sub">{CURRENCY}{fee * 2} · 2 people</span>
          </span>
          <span className="chev">›</span>
        </button>
        <button className="action-card" disabled={!session || busy || available < fee || guestsLeft < 1} onClick={() => setGuestMode('guest')}>
          <span className="action-ico">🎟️</span>
          <span className="action-body">
            <span className="action-title">Guest Only</span>
            <span className="action-sub">{CURRENCY}{fee} · 1 guest</span>
          </span>
          <span className="chev">›</span>
        </button>
      </div>
      {session && guestsBooked > 0 && (
        <div className="muted small center-text">
          Guests left this session: {Math.max(0, guestsLeft)} of {MAX_GUESTS_PER_SESSION}
        </div>
      )}
      {session && available < fee && (
        <div className="muted small center-text">Top up your balance to book (ask the admin / front desk).</div>
      )}

      {/* Pending bookings (active QRs) */}
      {pending.length > 0 && (
        <div className="card">
          <h3>Active bookings</h3>
          {pending.map((b) => (
            <Link key={b.id} to={`/booking/${b.id}`} className="row between listrow">
              <span>{labelFor(b)} · {b.peopleCount} {b.peopleCount > 1 ? 'people' : 'person'}</span>
              <span className="tag pending">Show QR ›</span>
            </Link>
          ))}
        </div>
      )}

      {/* History */}
      <div className="card">
        <h3>History</h3>
        {txns.length === 0 && (
          <div className="empty">
            <span className="ico">💳</span>
            <div className="t">No activity yet</div>
            <div className="small">Top-ups and check-ins show up here.</div>
          </div>
        )}
        {txns.map((t) => (
          <div key={t.id} className="row between listrow">
            <span>
              <span className={`dot ${t.amount >= 0 ? 'pos' : 'neg'}`} />
              {t.note}
            </span>
            <span className={t.amount >= 0 ? 'pos' : 'neg'}>
              {t.amount >= 0 ? '+' : '−'}{CURRENCY}{Math.abs(t.amount)}
            </span>
          </div>
        ))}
      </div>

      {guestMode && (
        <GuestForm
          title={guestMode === 'guest' ? 'Guest details' : 'Your guest'}
          busy={busy}
          onCancel={() => setGuestMode(null)}
          onSubmit={(guest) => book(guestMode, guest)}
        />
      )}
    </div>
  )
}

function labelFor(b) {
  if (b.type === 'self') return 'Myself'
  if (b.type === 'guest') return 'Guest only'
  return 'Myself + Guest'
}

function BalancePreview({ balance, fee }) {
  if (!fee) return null
  const remaining = balance - fee
  return (
    <div className="preview">
      <div><span className="muted small">After a 1-person check-in</span></div>
      <div className="row between">
        <span>Deduct</span>
        <span className="neg">−{CURRENCY}{fee}</span>
      </div>
      <div className="row between strong">
        <span>Remaining</span>
        <span className={remaining < 0 ? 'neg' : ''}>{CURRENCY}{remaining}</span>
      </div>
    </div>
  )
}
