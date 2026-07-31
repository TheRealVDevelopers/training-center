import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { CURRENCY } from '../config'
import {
  subscribeMembers,
  subscribeSessions,
  subscribeEntriesBetween,
  subscribeAllPayments,
} from '../lib/db'
import { attendanceOf, eligibleSessions, riskOf } from '../lib/attendance'
import { exportCsv } from '../lib/exportCsv'
import ThemeToggle from '../components/ThemeToggle'

// F6 — the month in one document. Read, not operated: big numbers, wide
// margins, one control (the month picker) and an export. Prints on paper for
// the owner to hand over.
export default function MonthReport() {
  const { month } = useParams()               // 'YYYY-MM'
  const nav = useNavigate()
  const [members, setMembers] = useState([])
  const [sessions, setSessions] = useState([])
  const [entries, setEntries] = useState([])
  const [payments, setPayments] = useState([])

  const key = /^\d{4}-\d{2}$/.test(month || '') ? month : thisMonth()
  const from = `${key}-01`
  const to = `${key}-31`

  useEffect(() => subscribeMembers(setMembers), [])
  useEffect(() => subscribeSessions(setSessions, 200), [])
  useEffect(() => subscribeEntriesBetween(from, to, setEntries), [from, to])
  useEffect(() => subscribeAllPayments(setPayments), [])

  // ---- This month ---------------------------------------------------------
  const monthSessions = useMemo(
    () => sessions.filter((s) => (s.date || s.id || '').startsWith(key) && s.status !== 'cancelled')
      .sort((a, b) => (a.date || '').localeCompare(b.date || '')),
    [sessions, key],
  )
  const pays = useMemo(
    () => payments.filter((p) => monthKeyOf(p.createdAt) === key),
    [payments, key],
  )
  const prevPays = useMemo(
    () => payments.filter((p) => monthKeyOf(p.createdAt) === prevMonth(key)),
    [payments, key],
  )

  const visits = entries.reduce((n, e) => n + 1 + (e.guests || 0), 0)
  const guests = entries.reduce((n, e) => n + (e.guests || 0), 0)
  const unique = new Set(entries.map((e) => e.memberId)).size
  const cash = pays.filter((p) => p.method === 'cash').reduce((n, p) => n + (p.amount || 0), 0)
  const upi = pays.filter((p) => p.method === 'upi').reduce((n, p) => n + (p.amount || 0), 0)
  const revenue = cash + upi
  const prevRevenue = prevPays.reduce((n, p) => n + (p.amount || 0), 0)
  const creditsSold = pays.reduce((n, p) => n + (p.credits || 0), 0)
  const joined = members.filter((m) => monthKeyOf(m.createdAt) === key)

  // Club-wide attendance % = attended ÷ every (member, session) pair they were
  // eligible for. Never divide by "all members × all sessions".
  const eligiblePairs = useMemo(
    () => members.reduce((n, m) => n + eligibleSessions(m, monthSessions).length, 0),
    [members, monthSessions],
  )
  const attendancePct = eligiblePairs ? Math.round((entries.length / eligiblePairs) * 100) : null

  // Per-member table + top attenders, using this month's sessions only.
  const perMember = useMemo(() => {
    const byMember = new Map()
    entries.forEach((e) => {
      if (!byMember.has(e.memberId)) byMember.set(e.memberId, [])
      byMember.get(e.memberId).push(e)
    })
    return members
      .map((m) => {
        const mine = byMember.get(m.id) || []
        const elig = eligibleSessions(m, monthSessions).length
        const paid = pays.filter((p) => p.memberId === m.id).reduce((n, p) => n + (p.amount || 0), 0)
        return {
          m,
          visits: mine.length,
          elig,
          pct: elig ? Math.round((mine.length / elig) * 100) : null,
          paid,
        }
      })
      .filter((r) => r.elig > 0 || r.paid > 0)
      .sort((a, b) => b.visits - a.visits || (a.m.name || '').localeCompare(b.m.name || ''))
  }, [members, entries, monthSessions, pays])

  const top = perMember.filter((r) => r.visits > 0).slice(0, 10)

  // Retention snapshot across all history (not just this month).
  const risk = useMemo(() => {
    const byMember = new Map()
    entries.forEach((e) => {
      if (!byMember.has(e.memberId)) byMember.set(e.memberId, [])
      byMember.get(e.memberId).push(e)
    })
    const out = { 'at-risk': 0, dormant: 0, never: 0 }
    members.forEach((m) => {
      const r = riskOf(attendanceOf(m, monthSessions, byMember.get(m.id) || []))
      if (out[r] != null) out[r]++
    })
    return out
  }, [members, entries, monthSessions])

  const months = useMemo(() => {
    const set = new Set(sessions.map((s) => (s.date || s.id || '').slice(0, 7)).filter(Boolean))
    payments.forEach((p) => { const k = monthKeyOf(p.createdAt); if (k) set.add(k) })
    set.add(thisMonth())
    return [...set].sort().reverse()
  }, [sessions, payments])

  function download() {
    const rows = [['Member', 'Level', 'Visits', 'Of', 'Attendance %', `Paid (${CURRENCY})`, 'Credits left']]
    perMember.forEach((r) => rows.push([
      r.m.name, r.m.tier || 'Associate', r.visits, r.elig,
      r.pct == null ? '' : r.pct, r.paid, r.m.credits || 0,
    ]))
    rows.push([])
    rows.push(['Saturdays', monthSessions.length, 'Visits', visits, 'Unique', unique])
    rows.push(['Cash', cash, 'UPI', upi, 'Total', revenue])
    exportCsv(`month-${key}`, rows)
  }

  const delta = prevRevenue ? Math.round(((revenue - prevRevenue) / prevRevenue) * 100) : null

  return (
    <div className="page wide report">
      <header className="topbar no-print">
        <div>
          <div className="brand"><span className="leaf">🌿</span>Month report</div>
          <div className="muted small">Saturday Training</div>
        </div>
        <div className="row gap">
          <ThemeToggle />
          <select value={key} onChange={(e) => nav(`/owner/month/${e.target.value}`)} style={{ width: 'auto' }}>
            {months.map((m) => <option key={m} value={m}>{monthName(m)}</option>)}
          </select>
          <button className="btn ghost small" onClick={() => window.print()}>🖨 Print</button>
          <button className="btn ghost small" onClick={download}>⬇ CSV</button>
          <Link className="btn ghost small" to="/owner">‹ Owner</Link>
        </div>
      </header>

      <div className="print-title">🌿 Saturday Training — {monthName(key)}</div>

      {/* The month in one line */}
      <div className="card rp-hero">
        <div className="rp-hero-line">
          <b>{monthSessions.length}</b> Saturday{monthSessions.length === 1 ? '' : 's'} ·
          {' '}<b>{unique}</b> member{unique === 1 ? '' : 's'} came ·
          {' '}<b>{visits}</b> visit{visits === 1 ? '' : 's'} ·
          {' '}<b>{CURRENCY}{revenue}</b> collected
        </div>
        {monthSessions.length === 0 && (
          <div className="muted small" style={{ marginTop: 6 }}>No sessions recorded in this month.</div>
        )}
      </div>

      <section className="mstats">
        <div className="mstat"><div className="mstat-val">{monthSessions.length ? Math.round(visits / monthSessions.length) : 0}</div><div className="mstat-lbl">Average per Saturday</div></div>
        <div className="mstat"><div className="mstat-val">{attendancePct == null ? '—' : `${attendancePct}%`}</div><div className="mstat-lbl">Club attendance</div></div>
        <div className="mstat"><div className="mstat-val">{joined.length}</div><div className="mstat-lbl">New members</div></div>
        <div className="mstat"><div className="mstat-val">{guests}</div><div className="mstat-lbl">Guests</div></div>
      </section>

      {/* Money */}
      <div className="card">
        <div className="row between" style={{ flexWrap: 'wrap', gap: 8 }}>
          <h3 style={{ margin: 0 }}>💰 Money</h3>
          <span className="muted small">
            {pays.length} recharge{pays.length === 1 ? '' : 's'} · {creditsSold} credits sold
            {delta != null && (
              <span className={delta >= 0 ? 'pos' : 'neg'}> · {delta >= 0 ? '▲' : '▼'} {Math.abs(delta)}% vs {monthName(prevMonth(key))}</span>
            )}
          </span>
        </div>
        <div className="an-pay">
          <div className="an-pay-cell"><span className="an-pay-lbl">💵 Cash</span><span className="an-pay-val">{CURRENCY}{cash}</span></div>
          <div className="an-pay-cell"><span className="an-pay-lbl">📲 UPI</span><span className="an-pay-val">{CURRENCY}{upi}</span></div>
          <div className="an-pay-cell total"><span className="an-pay-lbl">Total</span><span className="an-pay-val">{CURRENCY}{revenue}</span></div>
        </div>
      </div>

      {/* Saturdays */}
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Saturdays</h3>
        {monthSessions.length === 0 && <div className="muted small">Nothing recorded.</div>}
        {monthSessions.map((s) => {
          const day = entries.filter((e) => e.sessionId === s.id)
          const people = day.reduce((n, e) => n + 1 + (e.guests || 0), 0)
          return (
            <Link className="hist-row" key={s.id} to={`/owner/session/${s.id}`}>
              <span className="hist-ico in">📅</span>
              <div className="hist-body"><div className="hist-title">{dayName(s.date || s.id)}</div></div>
              <b>{people}</b><span className="muted" style={{ marginLeft: 8 }}>›</span>
            </Link>
          )
        })}
      </div>

      {/* Recognition */}
      {top.length > 0 && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>🏅 Most regular this month</h3>
          {top.map((r, i) => (
            <div key={r.m.id} className="hist-row">
              <span className="seq">{i + 1}</span>
              {r.m.photoURL ? <img className="avatar xs" src={r.m.photoURL} alt="" /> : <span className="avatar-fallback sm">{(r.m.name || '?')[0]}</span>}
              <div className="hist-body">
                <div className="hist-title"><Link to={`/owner/member/${r.m.id}`}>{r.m.name}</Link>{r.m.couple ? ' 👫' : ''}</div>
                <div className="muted small">{r.m.tier || 'Associate'}</div>
              </div>
              <b>{r.visits}/{r.elig}</b>
            </div>
          ))}
        </div>
      )}

      {/* Attention */}
      <div className="card">
        <div className="row between"><h3 style={{ margin: 0 }}>Needs attention</h3>
          <Link className="btn ghost small no-print" to="/owner/followup">Open follow-up ›</Link></div>
        <div className="an-pay" style={{ marginTop: 10 }}>
          <div className="an-pay-cell"><span className="an-pay-lbl">At risk (missed 2)</span><span className="an-pay-val">{risk['at-risk']}</span></div>
          <div className="an-pay-cell"><span className="an-pay-lbl">Dormant</span><span className="an-pay-val">{risk.dormant}</span></div>
          <div className="an-pay-cell"><span className="an-pay-lbl">Zero credits</span><span className="an-pay-val">{members.filter((m) => (m.credits || 0) < 1).length}</span></div>
        </div>
      </div>

      {/* Per-member table */}
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Every member</h3>
        <div className="rp-tablewrap">
          <table className="rp-table">
            <thead>
              <tr><th>Member</th><th>Level</th><th className="num">Visits</th><th className="num">Attendance</th><th className="num">Paid</th><th className="num">Credits</th></tr>
            </thead>
            <tbody>
              {perMember.map((r) => (
                <tr key={r.m.id}>
                  <td><Link to={`/owner/member/${r.m.id}`}>{r.m.name}</Link>{r.m.couple ? ' 👫' : ''}</td>
                  <td className="muted">{r.m.tier || 'Associate'}</td>
                  <td className="num">{r.visits}/{r.elig}</td>
                  <td className="num">{r.pct == null ? '—' : `${r.pct}%`}</td>
                  <td className="num">{r.paid ? `${CURRENCY}${r.paid}` : '—'}</td>
                  <td className="num">{r.m.credits || 0}</td>
                </tr>
              ))}
              {perMember.length === 0 && <tr><td colSpan={6} className="muted">No activity this month.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function thisMonth() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
function prevMonth(key) {
  const [y, m] = key.split('-').map(Number)
  const d = new Date(y, m - 2, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
function monthKeyOf(ts) {
  if (!ts?.seconds) return ''
  const d = new Date(ts.seconds * 1000)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
function monthName(key) {
  const [y, m] = key.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString([], { month: 'long', year: 'numeric' })
}
function dayName(date) {
  const [y, m, d] = String(date).split('-').map(Number)
  if (!y) return date
  return new Date(y, m - 1, d).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'short' })
}
