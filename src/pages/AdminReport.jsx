import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CURRENCY } from '../config'
import {
  subscribeActiveSession,
  subscribeSessionBookings,
  subscribeAllTopups,
  deleteTopup,
} from '../lib/db'

// End-of-day summary for the owner: who came, money in (top-ups by cash/UPI),
// money spent on entries, and a cash-drawer reconciliation line. Read-only.
export default function AdminReport() {
  const [session, setSession] = useState(null)
  const [bookings, setBookings] = useState([])
  const [topups, setTopups] = useState([])
  const [deletingId, setDeletingId] = useState('')

  async function removePayment(t) {
    if (!window.confirm(
      `Delete this ${CURRENCY}${t.amount} payment?\n\nThis removes it from the report and subtracts ${CURRENCY}${t.amount} back from the member's balance. This can't be undone.`,
    )) return
    setDeletingId(t.id)
    try {
      await deleteTopup(t.id)
    } catch (e) {
      alert(e.message || 'Could not delete payment')
    } finally {
      setDeletingId('')
    }
  }

  useEffect(() => subscribeActiveSession(setSession), [])
  useEffect(() => (session ? subscribeSessionBookings(session.id, setBookings) : undefined), [session])
  useEffect(() => subscribeAllTopups(setTopups), [])

  // Attendance / entry revenue (from this session's check-ins).
  const checkedIn = useMemo(() => bookings.filter((b) => b.status === 'checked_in'), [bookings])
  const attendees = checkedIn.reduce((n, b) => n + (b.peopleCount || 0), 0)
  const insideNow = checkedIn.filter((b) => !b.exitedAt).reduce((n, b) => n + (b.peopleCount || 0), 0)
  const leftCount = attendees - insideNow
  const guests = checkedIn.reduce((n, b) => n + (b.people?.filter((p) => p.isGuest).length || 0), 0)
  const entryRevenue = checkedIn.reduce((n, b) => n + (b.totalAmount || 0), 0)

  // Top-ups collected TODAY (the money that physically changed hands at the desk).
  const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0)
  const todaySec = startOfToday.getTime() / 1000
  const todayTopups = useMemo(
    () => topups.filter((t) => (t.createdAt?.seconds || 0) >= todaySec),
    [topups, todaySec],
  )
  const cashIn = todayTopups.filter((t) => t.method === 'cash').reduce((n, t) => n + (t.amount || 0), 0)
  const upiIn = todayTopups.filter((t) => t.method === 'upi').reduce((n, t) => n + (t.amount || 0), 0)
  const otherIn = todayTopups.filter((t) => t.method !== 'cash' && t.method !== 'upi').reduce((n, t) => n + (t.amount || 0), 0)
  const totalIn = cashIn + upiIn + otherIn

  const today = new Date().toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

  return (
    <div className="page">
      <header className="topbar no-print">
        <div>
          <div className="brand"><span className="leaf">🌿</span>Daily Report</div>
          <div className="muted small">{today}</div>
        </div>
        <div className="row gap">
          <button className="btn ghost small" onClick={() => window.print()}>🖨 Print / Save PDF</button>
          <Link className="btn ghost small" to="/admin">‹ Dashboard</Link>
        </div>
      </header>

      <div className="print-title">🌿 Saturday Training — Daily Report<br /><span>{today}</span></div>

      {/* Attendance */}
      <h3 className="section-h">Attendance</h3>
      <section className="report-grid">
        <div className="report-stat"><div className="rs-val">{attendees}</div><div className="rs-lbl">Total entries</div></div>
        <div className="report-stat"><div className="rs-val">{insideNow}</div><div className="rs-lbl">Inside now</div></div>
        <div className="report-stat"><div className="rs-val">{leftCount}</div><div className="rs-lbl">Left</div></div>
        <div className="report-stat"><div className="rs-val">{guests}</div><div className="rs-lbl">Guests</div></div>
      </section>
      {!session && <div className="banner">No active session — attendance shows zero until one is started.</div>}

      {/* Money in — reconciliation */}
      <h3 className="section-h">Money collected today (top-ups)</h3>
      <div className="card recon">
        <div className="recon-row"><span>💵 Cash</span><b>{CURRENCY}{cashIn}</b></div>
        <div className="recon-row"><span>📱 UPI</span><b>{CURRENCY}{upiIn}</b></div>
        {otherIn > 0 && <div className="recon-row"><span>Other / unspecified</span><b>{CURRENCY}{otherIn}</b></div>}
        <div className="recon-row total"><span>Total collected</span><b>{CURRENCY}{totalIn}</b></div>
        <div className="recon-note">
          💡 <b>Cash in drawer should be {CURRENCY}{cashIn}.</b> Count the cash box — it should match this exactly. UPI ({CURRENCY}{upiIn}) lands in your bank.
        </div>
        <div className="muted small" style={{ marginTop: 8 }}>{todayTopups.length} top-up{todayTopups.length === 1 ? '' : 's'} today</div>
      </div>

      {/* Entry value (credit spent, not new cash) */}
      <h3 className="section-h">Session usage</h3>
      <div className="card recon">
        <div className="recon-row"><span>Entry fees charged (from balances)</span><b>{CURRENCY}{entryRevenue}</b></div>
        <div className="recon-note">
          This is credit spent on entries — it was collected earlier as top-ups, so it is <b>not</b> new cash today. Kept separate on purpose.
        </div>
      </div>

      {/* Itemised top-ups */}
      {todayTopups.length > 0 && (
        <div className="card">
          <h3>Today’s top-ups</h3>
          <div className="report-list">
            {todayTopups
              .slice()
              .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0))
              .map((t) => (
                <div key={t.id} className="report-listrow">
                  <span className={`method-pill ${t.method || 'other'}`}>{(t.method || 'other').toUpperCase()}</span>
                  <span className="rl-note">{t.note}{t.ref ? ` · ${t.ref}` : ''}</span>
                  <span className="rl-time">{fmtTime(t.createdAt)}</span>
                  <b className="pos">+{CURRENCY}{t.amount}</b>
                  <button
                    className="rl-del no-print"
                    title="Delete this payment"
                    disabled={deletingId === t.id}
                    onClick={() => removePayment(t)}
                  >
                    {deletingId === t.id ? '…' : '🗑'}
                  </button>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  )
}

function fmtTime(ts) {
  if (!ts?.seconds) return '—'
  return new Date(ts.seconds * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
