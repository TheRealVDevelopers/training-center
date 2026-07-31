import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CURRENCY } from '../config'
import { subscribeAllPayments, subscribeMembers } from '../lib/db'
import { exportCsv } from '../lib/exportCsv'
import ThemeToggle from '../components/ThemeToggle'

// F11 — who took which money, on which device. Plain, boring, and the thing
// that answers "the cash doesn't match" without anyone's word against anyone's.
export default function ActivityLog() {
  const [payments, setPayments] = useState([])
  const [members, setMembers] = useState([])
  const [who, setWho] = useState('all')
  useEffect(() => subscribeAllPayments(setPayments), [])
  useEffect(() => subscribeMembers(setMembers), [])

  const byId = useMemo(() => Object.fromEntries(members.map((m) => [m.id, m])), [members])
  const actors = useMemo(() => {
    const s = new Set()
    payments.forEach((p) => s.add(labelOf(p)))
    return [...s].sort()
  }, [payments])

  const rows = useMemo(
    () => payments.filter((p) => who === 'all' || labelOf(p) === who),
    [payments, who],
  )

  const days = useMemo(() => {
    const map = new Map()
    for (const p of rows) {
      const key = dayOf(p.createdAt)
      if (!map.has(key)) map.set(key, [])
      map.get(key).push(p)
    }
    return [...map.entries()]
  }, [rows])

  function download() {
    const head = ['Date', 'Time', 'Member', 'Credits', `Amount (${CURRENCY})`, 'Method', 'Ref', 'Taken by', 'Device']
    const body = rows.map((p) => [
      dayOf(p.createdAt), timeOf(p.createdAt),
      p.memberName || byId[p.memberId]?.name || '', p.credits ?? '', p.amount ?? '',
      p.method || '', p.ref || '', p.by?.kind || 'unknown', p.by?.label || '',
    ])
    exportCsv(`activity-${new Date().toISOString().slice(0, 10)}`, [head, ...body])
  }

  return (
    <div className="page wide">
      <header className="topbar no-print">
        <div>
          <div className="brand"><span className="leaf">🌿</span>Activity log</div>
          <div className="muted small">Every recharge and correction — who, when, which device</div>
        </div>
        <div className="row gap">
          <ThemeToggle />
          <button className="btn ghost small" onClick={() => window.print()}>🖨 Print</button>
          <button className="btn ghost small" onClick={download}>⬇ CSV</button>
          <Link className="btn ghost small" to="/owner">‹ Owner</Link>
        </div>
      </header>

      {actors.length > 1 && (
        <div className="row gap no-print" style={{ margin: '4px 0 12px', flexWrap: 'wrap' }}>
          <div className="seg">
            <button className={who === 'all' ? 'on' : ''} onClick={() => setWho('all')}>Everyone</button>
            {actors.map((a) => (
              <button key={a} className={who === a ? 'on' : ''} onClick={() => setWho(a)}>{a}</button>
            ))}
          </div>
        </div>
      )}

      {days.length === 0 && <div className="card"><div className="muted small">No money activity recorded yet.</div></div>}

      {days.map(([day, list]) => {
        const cash = list.filter((p) => p.method === 'cash').reduce((n, p) => n + (p.amount || 0), 0)
        const upi = list.filter((p) => p.method === 'upi').reduce((n, p) => n + (p.amount || 0), 0)
        return (
          <div className="card" key={day}>
            <div className="row between" style={{ flexWrap: 'wrap', gap: 8 }}>
              <h3 style={{ margin: 0 }}>{dayName(day)}</h3>
              <span className="muted small">💵 {CURRENCY}{cash} · 📲 {CURRENCY}{upi} · <b>{CURRENCY}{cash + upi}</b></span>
            </div>
            <div style={{ marginTop: 8 }}>
              {list.map((p) => (
                <div key={p.id} className="hist-row">
                  <span className={`method-pill ${p.method || 'other'}`}>{(p.method || '—').toUpperCase()}</span>
                  <div className="hist-body">
                    <div className="hist-title">
                      {p.memberId
                        ? <Link to={`/owner/member/${p.memberId}`}>{p.memberName || byId[p.memberId]?.name || 'Member'}</Link>
                        : (p.memberName || 'Member')}
                      {p.credits != null && <span className="muted small"> · {p.credits > 0 ? '+' : ''}{p.credits} cr</span>}
                    </div>
                    <div className="muted small">
                      {timeOf(p.createdAt)} · {p.by?.label || 'unknown device'}
                      {p.by?.kind === 'owner' ? ' (owner)' : p.by?.kind === 'staff' ? ' (staff)' : ''}
                      {p.ref ? ` · ${p.ref}` : ''}
                    </div>
                  </div>
                  <b className={p.amount ? 'pos' : 'muted'}>{p.amount ? `+${CURRENCY}${p.amount}` : '—'}</b>
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

const labelOf = (p) => p.by?.label || 'unknown device'
function dayOf(ts) {
  if (!ts?.seconds) return '—'
  const d = new Date(ts.seconds * 1000)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
function timeOf(ts) {
  if (!ts?.seconds) return '—'
  return new Date(ts.seconds * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
function dayName(day) {
  const [y, m, d] = day.split('-').map(Number)
  if (!y) return day
  return new Date(y, m - 1, d).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })
}
