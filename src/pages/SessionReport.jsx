import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { CURRENCY } from '../config'
import { subscribeMembers, subscribeSessionEntries, subscribeAllPayments } from '../lib/db'
import { eligibleSessions } from '../lib/attendance'
import { waLink } from '../components/OwnerOnly'
import ThemeToggle from '../components/ThemeToggle'

// F5 — one Saturday in full. The "who didn't come" list is the point of this
// page: it turns into WhatsApp follow-ups in one tap.
export default function SessionReport() {
  const { date } = useParams()
  const [session, setSession] = useState(undefined)
  const [entries, setEntries] = useState([])
  const [members, setMembers] = useState([])
  const [payments, setPayments] = useState([])
  const [tab, setTab] = useState('came')

  useEffect(() => {
    getDoc(doc(db, 'sessions', date)).then((s) => setSession(s.exists() ? { id: s.id, ...s.data() } : null))
  }, [date])
  useEffect(() => subscribeSessionEntries(date, setEntries), [date])
  useEffect(() => subscribeMembers(setMembers), [])
  useEffect(() => subscribeAllPayments(setPayments), [])

  const attended = useMemo(
    () => [...entries].sort((a, b) => (a.at?.seconds || 0) - (b.at?.seconds || 0)),
    [entries],
  )
  const attendedIds = useMemo(() => new Set(entries.map((e) => e.memberId)), [entries])

  // Absent = eligible for THIS session (joined before it) and no entry.
  const absent = useMemo(() => {
    if (!session) return []
    return members
      .filter((m) => eligibleSessions(m, [session]).length > 0)
      .filter((m) => !attendedIds.has(m.id))
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
  }, [members, session, attendedIds])

  const newMembers = useMemo(() => {
    const start = session?.startedAt?.seconds || 0
    const dayStart = start - (start % 86400)
    return members.filter((m) => {
      const c = m.createdAt?.seconds || 0
      return c >= dayStart && c <= start + 86400
    })
  }, [members, session])

  const dayPayments = useMemo(
    () => payments.filter((p) => tsDate(p.createdAt) === date),
    [payments, date],
  )
  const cash = dayPayments.filter((p) => p.method === 'cash').reduce((n, p) => n + (p.amount || 0), 0)
  const upi = dayPayments.filter((p) => p.method === 'upi').reduce((n, p) => n + (p.amount || 0), 0)
  const guests = entries.reduce((n, e) => n + (e.guests || 0), 0)
  const headcount = entries.length + guests

  // Arrivals by 15-minute bucket — answers "when do we need staff at the door".
  const buckets = useMemo(() => {
    const map = new Map()
    for (const e of entries) {
      if (!e.at?.seconds) continue
      const d = new Date(e.at.seconds * 1000)
      const key = `${String(d.getHours()).padStart(2, '0')}:${d.getMinutes() < 30 ? '00' : '30'}`
      map.set(key, (map.get(key) || 0) + 1 + (e.guests || 0))
    }
    return [...map.entries()].sort()
  }, [entries])
  const peak = buckets.reduce((a, b) => (b[1] > (a?.[1] || 0) ? b : a), null)

  if (session === undefined) return <div className="center muted">Loading session…</div>
  if (!session) {
    return (
      <div className="center">
        <div className="card narrow center-text">
          <h3>No session on {date}</h3>
          <p className="muted">Nothing was recorded for this date.</p>
          <Link className="btn block" to="/owner">‹ Back to Owner</Link>
        </div>
      </div>
    )
  }

  return (
    <div className="page wide">
      <header className="topbar no-print">
        <div>
          <div className="brand"><span className="leaf">🌿</span>{fmtDay(date)}</div>
          <div className="muted small">
            Opened {fmtTime(session.startedAt)}{session.endedAt ? ` · closed ${fmtTime(session.endedAt)}` : ' · still open'}
          </div>
        </div>
        <div className="row gap">
          <ThemeToggle />
          <button className="btn ghost small" onClick={() => window.print()}>🖨 Print</button>
          <button className="btn ghost small" onClick={() => exportCsv(attended, absent, date)}>⬇ CSV</button>
          <Link className="btn ghost small" to="/owner">‹ Owner</Link>
        </div>
      </header>

      <div className="print-title">🌿 Saturday Training — {fmtDay(date)}</div>

      <section className="mstats">
        <div className="mstat"><div className="mstat-val">{headcount}</div><div className="mstat-lbl">People in</div></div>
        <div className="mstat"><div className="mstat-val">{absent.length}</div><div className="mstat-lbl">Did not come</div></div>
        <div className="mstat"><div className="mstat-val">{guests}</div><div className="mstat-lbl">Guests</div></div>
        <div className="mstat"><div className="mstat-val">{CURRENCY}{cash + upi}</div><div className="mstat-lbl">Collected</div></div>
      </section>

      {buckets.length > 0 && (
        <div className="card">
          <div className="row between"><h3 style={{ margin: 0 }}>Arrivals</h3>
            <span className="muted small">{peak ? `busiest ${peak[0]} · ${peak[1]} in` : ''}</span></div>
          <div className="arr-chart">
            {buckets.map(([t, n]) => (
              <div className="arr-col" key={t} title={`${t} — ${n}`}>
                <div className="arr-bar" style={{ height: `${(n / (peak?.[1] || 1)) * 100}%` }}><span>{n}</span></div>
                <div className="arr-lbl">{t}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="seg ownertabs no-print">
        <button className={tab === 'came' ? 'on' : ''} onClick={() => setTab('came')}>✓ Came ({entries.length})</button>
        <button className={tab === 'absent' ? 'on' : ''} onClick={() => setTab('absent')}>✗ Didn't come ({absent.length})</button>
        <button className={tab === 'money' ? 'on' : ''} onClick={() => setTab('money')}>💰 Money</button>
      </div>

      {(tab === 'came' || typeof window === 'undefined') && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Who came</h3>
          {attended.length === 0 && <div className="muted small">Nobody checked in on this day.</div>}
          {attended.map((e, i) => (
            <div key={e.id} className="hist-row">
              <span className="seq">{i + 1}</span>
              {e.photoURL ? <img className="avatar xs" src={e.photoURL} alt="" /> : <span className="avatar-fallback sm">{(e.name || '?')[0]}</span>}
              <div className="hist-body">
                <div className="hist-title">
                  <Link to={`/owner/member/${e.memberId}`}>{e.name}</Link>
                  {e.couple ? ' 👫' : ''}{e.guests ? ` +${e.guests} guest${e.guests > 1 ? 's' : ''}` : ''}
                </div>
                <div className="muted small">
                  In {fmtTime(e.at)}{e.exitedAt ? ` → left ${fmtTime(e.exitedAt)} · ${mins(e.at, e.exitedAt)}` : ''}
                  {e.gate ? ` · ${e.gate}` : ''}
                </div>
              </div>
              <span className={`tag ${e.exitedAt ? 'muted' : 'ok'}`}>{e.exitedAt ? 'left' : 'stayed'}</span>
            </div>
          ))}
        </div>
      )}

      {tab === 'absent' && (
        <div className="card">
          <div className="row between"><h3 style={{ margin: 0 }}>Who didn't come</h3>
            <span className="muted small">tap 💬 to follow up</span></div>
          {absent.length === 0 && <div className="muted small">Everyone came. 🎉</div>}
          {absent.map((m) => {
            const wa = waLink(m.mobile, `Hi ${m.name?.split(' ')[0] || ''} 👋 We missed you at Saturday Training on ${fmtDay(date)}. Hope to see you this week! 🌿`)
            return (
              <div key={m.id} className="hist-row">
                {m.photoURL ? <img className="avatar xs" src={m.photoURL} alt="" /> : <span className="avatar-fallback sm">{(m.name || '?')[0]}</span>}
                <div className="hist-body">
                  <div className="hist-title"><Link to={`/owner/member/${m.id}`}>{m.name}</Link>{m.couple ? ' 👫' : ''}</div>
                  <div className="muted small">{m.tier || 'Associate'} · {m.credits || 0} credits{m.mobile ? ` · ${m.mobile}` : ''}</div>
                </div>
                {wa && <a className="btn small no-print" href={wa} target="_blank" rel="noreferrer">💬</a>}
              </div>
            )
          })}
        </div>
      )}

      {tab === 'money' && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Money on this day</h3>
          <div className="an-pay">
            <div className="an-pay-cell"><span className="an-pay-lbl">💵 Cash</span><span className="an-pay-val">{CURRENCY}{cash}</span></div>
            <div className="an-pay-cell"><span className="an-pay-lbl">📲 UPI</span><span className="an-pay-val">{CURRENCY}{upi}</span></div>
            <div className="an-pay-cell total"><span className="an-pay-lbl">Total</span><span className="an-pay-val">{CURRENCY}{cash + upi}</span></div>
          </div>
          <div style={{ marginTop: 12 }}>
            {dayPayments.length === 0 && <div className="muted small">No recharges on this day.</div>}
            {dayPayments.map((p) => (
              <div key={p.id} className="hist-row">
                <span className={`method-pill ${p.method || 'other'}`}>{(p.method || '—').toUpperCase()}</span>
                <div className="hist-body">
                  <div className="hist-title">{members.find((m) => m.id === p.memberId)?.name || 'Member'} · +{p.credits ?? 0} cr</div>
                  <div className="muted small">{fmtTime(p.createdAt)}{p.ref ? ` · ${p.ref}` : ''}</div>
                </div>
                <b className="pos">+{CURRENCY}{p.amount}</b>
              </div>
            ))}
          </div>
        </div>
      )}

      {newMembers.length > 0 && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Joined on this day</h3>
          {newMembers.map((m) => (
            <div key={m.id} className="hist-row">
              <span className="hist-ico in">🎉</span>
              <div className="hist-body"><div className="hist-title"><Link to={`/owner/member/${m.id}`}>{m.name}</Link></div></div>
              <span className="muted small">{m.tier}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function exportCsv(attended, absent, date) {
  const rows = [['status', 'name', 'in', 'out', 'guests', 'gate']]
  attended.forEach((e) => rows.push(['came', e.name || '', fmtTime(e.at), e.exitedAt ? fmtTime(e.exitedAt) : '', e.guests || 0, e.gate || '']))
  absent.forEach((m) => rows.push(['absent', m.name || '', '', '', '', '']))
  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
  a.download = `session-${date}.csv`
  a.click()
}

const tsDate = (ts) => {
  if (!ts?.seconds) return ''
  const d = new Date(ts.seconds * 1000)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
function fmtDay(date) {
  const [y, m, d] = String(date).split('-').map(Number)
  if (!y) return date
  return new Date(y, m - 1, d).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })
}
function fmtTime(ts) {
  if (!ts?.seconds) return '—'
  return new Date(ts.seconds * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
function mins(a, b) {
  if (!a?.seconds || !b?.seconds) return ''
  const m = Math.round((b.seconds - a.seconds) / 60)
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`
}
