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
  const [guestMode, setGuestMode] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => subscribeActiveSession(setSession), [])
  useEffect(() => (member ? subscribeMemberBookings(member.id, setBookings) : undefined), [member])
  useEffect(() => (member ? subscribeTransactions(member.id, setTxns) : undefined), [member])

  if (!member) return <div className="center muted">Loading your profile…</div>

  const fee = session?.feePerPerson ?? 0
  const balance = member.balance || 0
  const reserved = member.reserved || 0
  const available = balance - reserved
  const guestsBooked = bookings
    .filter((b) => b.sessionId === session?.id && b.status !== 'cancelled')
    .reduce((n, b) => n + (b.people?.filter((p) => p.isGuest).length || 0), 0)
  const guestsLeft = MAX_GUESTS_PER_SESSION - guestsBooked

  // Membership-card facts
  const sessionsBookable = fee ? Math.floor(available / fee) : 0
  const attended = bookings.filter((b) => b.status === 'checked_in').length
  const guestsBrought = bookings
    .filter((b) => b.status === 'checked_in')
    .reduce((n, b) => n + (b.people?.filter((p) => p.isGuest).length || 0), 0)
  const toppedUp = txns.filter((t) => t.type === 'topup').reduce((n, t) => n + t.amount, 0)
  const memberSince = member.createdAt?.seconds
    ? new Date(member.createdAt.seconds * 1000).toLocaleDateString([], { month: 'short', year: 'numeric' })
    : null
  const memberId = (member.id || '').slice(-5).toUpperCase()

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

      {/* Membership card */}
      <section className="hero memcard">
        <div className="memcard-top">
          <div className="memcard-id">
            {member.photoURL
              ? <img src={member.photoURL} alt="" />
              : <span className="avatar-fallback">{(member.name || '?')[0]}</span>}
            <div>
              <div className="memcard-name">{member.name}</div>
              <div className="memcard-role">Saturday Training · Member</div>
            </div>
          </div>
          <span className="memcard-chip">MEMBER</span>
        </div>

        <div>
          <div className="muted small">Current balance</div>
          <div className="balance">{CURRENCY}<CountUp value={balance} /></div>
        </div>

        <div className="memcard-facts">
          <div><span className="f-val">{Math.max(0, sessionsBookable)}</span><span className="f-lbl">sessions to book</span></div>
          <div><span className="f-val">{CURRENCY}{reserved}</span><span className="f-lbl">on hold</span></div>
          <div><span className="f-val">{fee ? `${CURRENCY}${fee}` : '—'}</span><span className="f-lbl">per session</span></div>
        </div>

        <div className="memcard-foot">
          <span>•••• {memberId || '00000'}</span>
          <span>{memberSince ? `SINCE ${memberSince.toUpperCase()}` : ''}</span>
        </div>
      </section>

      {/* Quick stats */}
      <section className="mstats">
        <div className="mstat"><div className="mstat-val"><CountUp value={attended} /></div><div className="mstat-lbl">Sessions attended</div></div>
        <div className="mstat"><div className="mstat-val"><CountUp value={guestsBrought} /></div><div className="mstat-lbl">Guests brought</div></div>
        <div className="mstat"><div className="mstat-val">{CURRENCY}<CountUp value={toppedUp} /></div><div className="mstat-lbl">Total topped up</div></div>
      </section>

      {!session && <div className="banner warn">No active session right now. Ask the admin to start one.</div>}
      {err && <div className="error">{err}</div>}

      <h3 className="section-h">Book your Saturday slot</h3>
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
      {session && available < fee && (
        <div className="topup-note">
          <span>💳</span> You have {CURRENCY}{available} available — top up at the front desk to book a session.
        </div>
      )}
      {session && guestsBooked > 0 && (
        <div className="muted small center-text">Guests left this session: {Math.max(0, guestsLeft)} of {MAX_GUESTS_PER_SESSION}</div>
      )}

      {/* Active bookings */}
      {pending.length > 0 && (
        <div className="card">
          <h3>Your QR passes</h3>
          {pending.map((b) => (
            <Link key={b.id} to={`/booking/${b.id}`} className="row between listrow">
              <span>{labelFor(b)} · {b.peopleCount} {b.peopleCount > 1 ? 'people' : 'person'}</span>
              <span className="tag pending">Show QR ›</span>
            </Link>
          ))}
        </div>
      )}

      {/* Activity */}
      <div className="card">
        <div className="row between"><h3 style={{ margin: 0 }}>Activity</h3><span className="muted small">{txns.length} {txns.length === 1 ? 'entry' : 'entries'}</span></div>
        {txns.length === 0 ? (
          <div className="empty">
            <span className="ico">💳</span>
            <div className="t">No activity yet</div>
            <div className="small">Top-ups and check-ins show up here.</div>
          </div>
        ) : (
          <div style={{ marginTop: 12 }}>
            {txns.map((t) => (
              <div key={t.id} className="hist-row">
                <span className={`hist-ico ${t.type === 'topup' ? 'in' : 'out'}`}>{t.type === 'topup' ? '💳' : '🎟️'}</span>
                <div className="hist-body">
                  <div className="hist-title">{t.note}</div>
                  <div className="muted small">{fmtDate(t.createdAt)}</div>
                </div>
                <div className={`hist-amt ${t.amount >= 0 ? 'pos' : 'neg'}`}>
                  {t.amount >= 0 ? '+' : '−'}{CURRENCY}{Math.abs(t.amount)}
                </div>
              </div>
            ))}
          </div>
        )}
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

function fmtDate(ts) {
  if (!ts?.seconds) return 'just now'
  const d = new Date(ts.seconds * 1000)
  return `${d.toLocaleDateString([], { day: 'numeric', month: 'short' })} · ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
}
