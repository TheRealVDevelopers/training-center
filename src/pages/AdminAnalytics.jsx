import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CURRENCY, SESSION } from '../config'
import { useAuth } from '../auth/AuthContext'
import { clearAccess } from '../lib/access'
import CountUp from '../components/CountUp'
import {
  subscribeMembers,
  subscribeActiveSession,
  subscribeSessionBookings,
  subscribeAllTopups,
} from '../lib/db'

// Analytics — the numbers behind the day: who entered, how many are enrolled,
// how much money came in (cash vs UPI), and who's low on credit. Read-only.
export default function AdminAnalytics() {
  const { isSuper, logout } = useAuth()
  const [members, setMembers] = useState([])
  const [session, setSession] = useState(null)
  const [bookings, setBookings] = useState([])
  const [topups, setTopups] = useState([])

  useEffect(() => subscribeMembers(setMembers), [])
  useEffect(() => subscribeActiveSession(setSession), [])
  useEffect(() => subscribeAllTopups(setTopups), [])
  useEffect(() => (session ? subscribeSessionBookings(session.id, setBookings) : setBookings([])), [session])

  const fee = session?.feePerPerson ?? SESSION.feePerPerson

  // Attendance (current session)
  const checkedIn = useMemo(
    () => bookings
      .filter((b) => b.status === 'checked_in')
      .sort((a, b) => (b.checkedInAt?.seconds || 0) - (a.checkedInAt?.seconds || 0)),
    [bookings],
  )
  const enteredToday = checkedIn.reduce((n, b) => n + (b.peopleCount || 0), 0)
  const insideNow = checkedIn.filter((b) => !b.exitedAt).reduce((n, b) => n + (b.peopleCount || 0), 0)
  const guestsToday = checkedIn.reduce((n, b) => n + Math.max(0, (b.peopleCount || 1) - 1), 0)
  const entryRevenue = checkedIn.reduce((n, b) => n + (b.totalAmount || 0), 0)

  // Enrollment
  const enrolled = members.length
  const lowBalance = members.filter((m) => (m.balance || 0) < fee).length

  // Payments — top-ups since local midnight, split by method.
  const startOfToday = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime() / 1000 }, [])
  const topupsToday = topups.filter((t) => (t.createdAt?.seconds || 0) >= startOfToday)
  const payToday = topupsToday.reduce((n, t) => n + (t.amount || 0), 0)
  const cashToday = topupsToday.filter((t) => t.method === 'cash').reduce((n, t) => n + (t.amount || 0), 0)
  const upiToday = topupsToday.filter((t) => t.method === 'upi').reduce((n, t) => n + (t.amount || 0), 0)
  const payAllTime = topups.reduce((n, t) => n + (t.amount || 0), 0)

  const lockOrLogout = isSuper ? (
    <button className="btn ghost small" onClick={logout}>Log out</button>
  ) : (
    <button className="btn ghost small" onClick={() => { clearAccess('admin'); window.location.reload() }}>Lock</button>
  )

  return (
    <div className="page wide">
      <header className="topbar">
        <div>
          <div className="brand"><span className="leaf">🌿</span>Analytics</div>
          <div className="muted small">{session ? '🟢 Session live' : '⏳ No active session'}</div>
        </div>
        <div className="row gap">
          <Link className="btn ghost small" to="/admin">‹ Reception</Link>
          <Link className="btn ghost small" to="/admin/credits">Credits</Link>
          <Link className="btn ghost small" to="/admin/report">Daily report</Link>
          {lockOrLogout}
        </div>
      </header>

      {/* Headline numbers */}
      <section className="mstats an-stats">
        <div className="mstat"><div className="mstat-val"><CountUp value={insideNow} /></div><div className="mstat-lbl">Inside now</div></div>
        <div className="mstat"><div className="mstat-val"><CountUp value={enteredToday} /></div><div className="mstat-lbl">Entered today</div></div>
        <div className="mstat"><div className="mstat-val"><CountUp value={enrolled} /></div><div className="mstat-lbl">Members enrolled</div></div>
        <div className="mstat"><div className="mstat-val">{CURRENCY}<CountUp value={payToday} /></div><div className="mstat-lbl">Payments today</div></div>
      </section>

      {/* Payments breakdown */}
      <div className="card">
        <div className="row between"><h3 style={{ margin: 0 }}>💰 Payments today</h3><span className="muted small">{topupsToday.length} recharge{topupsToday.length === 1 ? '' : 's'}</span></div>
        <div className="an-pay">
          <div className="an-pay-cell"><span className="an-pay-lbl">💵 Cash</span><span className="an-pay-val">{CURRENCY}{cashToday}</span></div>
          <div className="an-pay-cell"><span className="an-pay-lbl">📲 UPI</span><span className="an-pay-val">{CURRENCY}{upiToday}</span></div>
          <div className="an-pay-cell total"><span className="an-pay-lbl">Total today</span><span className="an-pay-val">{CURRENCY}{payToday}</span></div>
        </div>
        <div className="muted small" style={{ marginTop: 10 }}>
          Entry revenue this session: <b>{CURRENCY}{entryRevenue}</b> · All-time top-ups: <b>{CURRENCY}{payAllTime}</b>
        </div>
      </div>

      {/* Session snapshot */}
      <section className="mstats">
        <div className="mstat"><div className="mstat-val"><CountUp value={guestsToday} /></div><div className="mstat-lbl">Guests today</div></div>
        <div className="mstat"><div className="mstat-val"><CountUp value={checkedIn.length} /></div><div className="mstat-lbl">Members entered</div></div>
        <div className="mstat"><div className="mstat-val" style={{ color: lowBalance ? 'var(--danger)' : undefined }}><CountUp value={lowBalance} /></div><div className="mstat-lbl">Low balance</div></div>
      </section>

      {/* Who entered */}
      <div className="card">
        <div className="row between"><h3 style={{ margin: 0 }}>Who entered</h3><span className="muted small">{checkedIn.length} {checkedIn.length === 1 ? 'person' : 'people'}</span></div>
        {!session && <div className="muted small" style={{ marginTop: 10 }}>No session running — start one from Reception to track today's entries.</div>}
        {session && checkedIn.length === 0 && (
          <div className="empty"><span className="ico">🚪</span><div className="t">No entries yet</div><div className="small">People appear here as they tap in.</div></div>
        )}
        {checkedIn.length > 0 && (
          <div style={{ marginTop: 12 }}>
            {checkedIn.map((b) => {
              const photo = b.people?.[0]?.photoURL
              return (
                <div key={b.id} className="hist-row">
                  {photo ? <img className="avatar xs" src={photo} alt="" /> : <span className="avatar-fallback sm">{(b.memberName || '?')[0]}</span>}
                  <div className="hist-body">
                    <div className="hist-title">{b.memberName}{b.peopleCount > 1 ? ` +${b.peopleCount - 1}` : ''}</div>
                    <div className="muted small">Entered {fmtTime(b.checkedInAt)}{b.exitedAt ? ` · left ${fmtTime(b.exitedAt)}` : ''}</div>
                  </div>
                  <span className={`tag ${b.exitedAt ? 'muted' : 'ok'}`}>{b.exitedAt ? 'left' : 'inside'}</span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function fmtTime(ts) {
  if (!ts?.seconds) return 'now'
  return new Date(ts.seconds * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
