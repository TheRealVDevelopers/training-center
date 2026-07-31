import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { subscribeMembers, subscribeSessions, subscribeEntriesBetween } from '../lib/db'
import { attendanceOf, riskOf, RISK_LABEL } from '../lib/attendance'
import { waLink } from '../components/OwnerOnly'
import ThemeToggle from '../components/ThemeToggle'

// F9 — the Sunday-morning list. Who is drifting away, in priority order, each
// with a one-tap WhatsApp. Retention is where the money is; this page is the
// cheapest retention tool the club has.
const BUCKETS = [
  { key: 'dormant', title: '🔴 Dormant — a month away', hint: 'Missed 4+ Saturdays. A personal call works better than a message.' },
  { key: 'at-risk', title: '🟠 At risk — missed 2', hint: 'The moment that decides whether they come back. Message today.' },
  { key: 'slipping', title: '🟡 Missed last week', hint: 'A friendly nudge is usually enough.' },
  { key: 'never', title: '⚪ Never attended', hint: 'Signed up but never walked in — invite them personally.' },
]

export default function FollowUp() {
  const [members, setMembers] = useState([])
  const [sessions, setSessions] = useState([])
  const [entries, setEntries] = useState([])
  const [open, setOpen] = useState({})

  useEffect(() => subscribeMembers(setMembers), [])
  useEffect(() => subscribeSessions(setSessions, 60), [])
  // Bounded window — never subscribe to the whole entries collection.
  useEffect(() => {
    const from = new Date(); from.setMonth(from.getMonth() - 6)
    const p = (n) => String(n).padStart(2, '0')
    const key = `${from.getFullYear()}-${p(from.getMonth() + 1)}-${p(from.getDate())}`
    return subscribeEntriesBetween(key, '9999-12-31', setEntries)
  }, [])

  const byMember = useMemo(() => {
    const map = new Map()
    for (const e of entries) {
      if (!map.has(e.memberId)) map.set(e.memberId, [])
      map.get(e.memberId).push(e)
    }
    return map
  }, [entries])

  const rows = useMemo(() => {
    if (!sessions.length) return []
    return members
      .map((m) => {
        const att = attendanceOf(m, sessions, byMember.get(m.id) || [])
        return { m, att, risk: riskOf(att) }
      })
      .sort((a, b) => (b.att.missedInARow || 0) - (a.att.missedInARow || 0))
  }, [members, sessions, byMember])

  const grouped = useMemo(() => {
    const g = {}
    for (const b of BUCKETS) g[b.key] = rows.filter((r) => r.risk === b.key)
    return g
  }, [rows])

  const regular = rows.filter((r) => r.risk === 'regular').length
  const needsAttention = BUCKETS.reduce((n, b) => n + (grouped[b.key]?.length || 0), 0)

  // F13 — who will be turned away at the door on Saturday unless they recharge.
  // Regular attenders first: they are the ones who will actually turn up.
  const lowCredit = useMemo(
    () => rows
      .filter((r) => (r.m.credits || 0) < 1 && r.risk !== 'never' && r.risk !== 'dormant')
      .sort((a, b) => (b.att.pct ?? 0) - (a.att.pct ?? 0)),
    [rows],
  )

  return (
    <div className="page wide">
      <header className="topbar">
        <div>
          <div className="brand"><span className="leaf">🌿</span>Follow-up</div>
          <div className="muted small">Who is drifting away — message them before they stop coming</div>
        </div>
        <div className="row gap">
          <ThemeToggle />
          <Link className="btn ghost small" to="/owner">‹ Owner</Link>
        </div>
      </header>

      <section className="mstats">
        <div className="mstat"><div className="mstat-val">{regular}</div><div className="mstat-lbl">Regular</div></div>
        <div className="mstat"><div className="mstat-val" style={{ color: grouped['at-risk']?.length ? 'var(--warn)' : undefined }}>{grouped['at-risk']?.length || 0}</div><div className="mstat-lbl">At risk</div></div>
        <div className="mstat"><div className="mstat-val" style={{ color: grouped.dormant?.length ? 'var(--danger)' : undefined }}>{grouped.dormant?.length || 0}</div><div className="mstat-lbl">Dormant</div></div>
        <div className="mstat"><div className="mstat-val">{needsAttention}</div><div className="mstat-lbl">Need a message</div></div>
      </section>

      {!sessions.length && (
        <div className="card"><div className="muted small">No Saturdays recorded yet — this list fills up after the first few sessions.</div></div>
      )}

      {/* Low credit — they'll be stopped at the door unless they recharge */}
      {lowCredit.length > 0 && (
        <div className="card">
          <div className="row between" style={{ flexWrap: 'wrap', gap: 8 }}>
            <h3 style={{ margin: 0 }}>💳 Out of credits ({lowCredit.length})</h3>
            <span className="muted small">Regular attenders first — remind them before Saturday</span>
          </div>
          {lowCredit.slice(0, 20).map(({ m, att }) => {
            const first = m.name?.split(' ')[0] || ''
            const wa = waLink(m.mobile, `Hi ${first} 👋 Quick reminder — your entries are finished. Recharge at the desk this Saturday and you're straight in. 🌿`)
            return (
              <div key={m.id} className="hist-row">
                {m.photoURL ? <img className="avatar xs" src={m.photoURL} alt="" /> : <span className="avatar-fallback sm">{(m.name || '?')[0]}</span>}
                <div className="hist-body">
                  <div className="hist-title"><Link to={`/owner/member/${m.id}`}>{m.name}</Link>{m.couple ? ' 👫' : ''}</div>
                  <div className="muted small">
                    {att.pct != null ? `${att.pct}% attendance` : 'new member'} · 0 credits · {m.tier || 'Associate'}
                  </div>
                </div>
                {wa && <a className="btn small" href={wa} target="_blank" rel="noreferrer">💬</a>}
              </div>
            )
          })}
        </div>
      )}

      {BUCKETS.map((b) => {
        const list = grouped[b.key] || []
        if (!list.length) return null
        const isOpen = open[b.key] !== false
        return (
          <div className="card" key={b.key}>
            <button className="fu-head" onClick={() => setOpen({ ...open, [b.key]: !isOpen })}>
              <span><b>{b.title}</b> <span className="muted small">· {list.length}</span></span>
              <span className="muted">{isOpen ? '▾' : '▸'}</span>
            </button>
            <div className="muted small" style={{ margin: '2px 0 8px' }}>{b.hint}</div>
            {isOpen && list.map(({ m, att }) => {
              const first = m.name?.split(' ')[0] || ''
              const wa = waLink(
                m.mobile,
                b.key === 'never'
                  ? `Hi ${first} 👋 You're registered for Saturday Training but we haven't seen you yet! This Saturday 6pm — come along, we'll get you started. 🌿`
                  : `Hi ${first} 👋 We missed you at Saturday Training${att.lastSeen ? ` since ${fmtDay(att.lastSeen)}` : ''}. This Saturday 6pm — hope to see you! 🌿`,
              )
              return (
                <div key={m.id} className="hist-row">
                  {m.photoURL ? <img className="avatar xs" src={m.photoURL} alt="" /> : <span className="avatar-fallback sm">{(m.name || '?')[0]}</span>}
                  <div className="hist-body">
                    <div className="hist-title"><Link to={`/owner/member/${m.id}`}>{m.name}</Link>{m.couple ? ' 👫' : ''}</div>
                    <div className="muted small">
                      {att.lastSeen ? `last seen ${fmtDay(att.lastSeen)}` : 'never attended'}
                      {att.pct != null ? ` · ${att.pct}% attendance` : ''}
                      {` · ${m.credits || 0} credits`}
                    </div>
                  </div>
                  {wa
                    ? <a className="btn small primary" href={wa} target="_blank" rel="noreferrer">💬 Message</a>
                    : <span className="muted small">no mobile</span>}
                </div>
              )
            })}
          </div>
        )
      })}

      {sessions.length > 0 && needsAttention === 0 && (
        <div className="card center-text">
          <div className="empty"><span className="ico">🎉</span>
            <div className="t">Everyone is coming regularly</div>
            <div className="small">Nobody has missed two Saturdays in a row.</div></div>
        </div>
      )}
    </div>
  )
}

function fmtDay(date) {
  const [y, m, d] = String(date).split('-').map(Number)
  if (!y) return date
  return new Date(y, m - 1, d).toLocaleDateString([], { day: 'numeric', month: 'short' })
}
