import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { CURRENCY, TIERS } from '../config'
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
  const creditsSold = dayPayments.reduce((n, p) => n + (p.credits || 0), 0)
  const guests = entries.reduce((n, e) => n + (e.guests || 0), 0)
  const headcount = entries.length + guests
  const memberById = useMemo(() => Object.fromEntries(members.map((m) => [m.id, m])), [members])
  // The level a member was ON THE DAY is stamped on the entry; fall back to
  // their profile for older rows written before that field existed.
  const tierOf = (e) => e.tier || memberById[e.memberId]?.tier || 'No level set'

  // Level-wise split of who walked in — the headline of the end-of-day report.
  const byTier = useMemo(() => {
    const counts = {}
    entries.forEach((e) => { const t = tierOf(e); counts[t] = (counts[t] || 0) + 1 })
    const order = [...Object.keys(TIERS), 'No level set']
    return order.filter((t) => counts[t]).map((t) => ({ tier: t, count: counts[t] }))
  }, [entries, memberById]) // eslint-disable-line react-hooks/exhaustive-deps

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
          <div className="brand"><span className="leaf">🌿</span>End of day</div>
          <div className="muted small">
            {fmtDay(date)} · Opened {fmtTime(session.startedAt)}{session.endedAt ? ` · closed ${fmtTime(session.endedAt)}` : ' · still open'}
          </div>
        </div>
        <div className="row gap">
          <ThemeToggle />
          <button className="btn ghost small" onClick={() => window.print()}>🖨 Print</button>
          <button className="btn ghost small" onClick={() => exportCsv({ date, entries: attended, absent, payments: dayPayments, byTier, memberById, cash, upi, guests, creditsSold })}>⬇ CSV</button>
          <Link className="btn ghost small" to="/owner">‹ Owner</Link>
        </div>
      </header>

      <div className="print-title">🌿 Saturday Training — End of day<br /><span>{fmtDay(date)}</span></div>

      <section className="mstats">
        <div className="mstat"><div className="mstat-val">{entries.length}</div><div className="mstat-lbl">Members checked in</div></div>
        <div className="mstat"><div className="mstat-val">{guests}</div><div className="mstat-lbl">Guests</div></div>
        <div className="mstat"><div className="mstat-val">{headcount}</div><div className="mstat-lbl">Total people</div></div>
        <div className="mstat"><div className="mstat-val">{CURRENCY}{cash + upi}</div><div className="mstat-lbl">Collected</div></div>
      </section>

      {/* Money — the number the drawer is counted against */}
      <div className="card">
        <div className="row between" style={{ flexWrap: 'wrap', gap: 8 }}>
          <h3 style={{ margin: 0 }}>💰 Money collected</h3>
          <span className="muted small">{dayPayments.length} renewal{dayPayments.length === 1 ? '' : 's'} · {creditsSold} credits sold</span>
        </div>
        <div className="an-pay">
          <div className="an-pay-cell"><span className="an-pay-lbl">💵 Cash</span><span className="an-pay-val">{CURRENCY}{cash}</span></div>
          <div className="an-pay-cell"><span className="an-pay-lbl">📲 UPI</span><span className="an-pay-val">{CURRENCY}{upi}</span></div>
          <div className="an-pay-cell total"><span className="an-pay-lbl">Total</span><span className="an-pay-val">{CURRENCY}{cash + upi}</span></div>
        </div>
        <div className="recon-note">
          💡 <b>Cash in the drawer should be {CURRENCY}{cash}.</b> Count it before closing — UPI ({CURRENCY}{upi}) lands in the bank.
        </div>
      </div>

      {/* Level-wise: how many of each level walked in today */}
      <div className="card">
        <div className="row between" style={{ flexWrap: 'wrap', gap: 8 }}>
          <h3 style={{ margin: 0 }}>🏆 Level-wise attendance</h3>
          <span className="muted small">{entries.length} member{entries.length === 1 ? '' : 's'}</span>
        </div>
        {byTier.length === 0 ? (
          <div className="muted small" style={{ marginTop: 8 }}>Nobody checked in.</div>
        ) : (
          <div style={{ marginTop: 10 }}>
            {byTier.map((r) => (
              <div key={r.tier} className="lvl-row">
                <span className="lvl-name">{r.tier}</span>
                <span className="lvl-bar"><span style={{ width: `${(r.count / entries.length) * 100}%` }} /></span>
                <b className="lvl-n">{r.count}</b>
              </div>
            ))}
            {guests > 0 && (
              <div className="lvl-row">
                <span className="lvl-name muted">Guests (brought along)</span>
                <span className="lvl-bar" />
                <b className="lvl-n">{guests}</b>
              </div>
            )}
          </div>
        )}
      </div>

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
          <div className="row between" style={{ flexWrap: 'wrap', gap: 8 }}>
            <h3 style={{ margin: 0 }}>Who paid today</h3>
            <span className="muted small">name · level · club · method — every renewal taken</span>
          </div>
          <div className="rp-tablewrap">
            <table className="rp-table">
              <thead>
                <tr>
                  <th>Time</th><th>Member</th><th>Level</th><th>Club</th>
                  <th className="num">Credits</th><th className="num">Amount</th><th>Method</th><th>Taken by</th>
                </tr>
              </thead>
              <tbody>
                {dayPayments.map((p) => {
                  const m = memberById[p.memberId]
                  return (
                    <tr key={p.id}>
                      <td>{fmtTime(p.createdAt)}</td>
                      <td>
                        {p.memberId
                          ? <Link to={`/owner/member/${p.memberId}`}>{p.memberName || m?.name || 'Member'}</Link>
                          : (p.memberName || 'Member')}
                        {m?.couple ? ' 👫' : ''}
                      </td>
                      <td className="muted">{m?.tier || '—'}</td>
                      <td className="muted">{m?.clubName || '—'}</td>
                      <td className="num">+{p.credits ?? 0}</td>
                      <td className="num"><b>{CURRENCY}{p.amount || 0}</b></td>
                      <td><span className={`method-pill ${p.method || 'other'}`}>{(p.method || '—').toUpperCase()}</span>
                        {p.ref ? <div className="muted small">{p.ref}</div> : null}</td>
                      <td className="muted">{p.by?.label || '—'}</td>
                    </tr>
                  )
                })}
                {dayPayments.length === 0 && <tr><td colSpan={8} className="muted">No renewals taken on this day.</td></tr>}
              </tbody>
              {dayPayments.length > 0 && (
                <tfoot>
                  <tr>
                    <th colSpan={4}>Total</th>
                    <th className="num">{creditsSold}</th>
                    <th className="num">{CURRENCY}{cash + upi}</th>
                    <th colSpan={2} className="muted">💵 {CURRENCY}{cash} · 📲 {CURRENCY}{upi}</th>
                  </tr>
                </tfoot>
              )}
            </table>
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

// One CSV that holds the whole day: the summary, the level split, every
// payment with the payer's details, and who came / didn't.
function exportCsv({ date, entries, absent, payments, byTier, memberById, cash, upi, guests, creditsSold }) {
  const rows = []
  rows.push([`END OF DAY — ${date}`])
  rows.push([])
  rows.push(['SUMMARY'])
  rows.push(['Members checked in', entries.length])
  rows.push(['Guests', guests])
  rows.push(['Total people', entries.length + guests])
  rows.push(['Did not come', absent.length])
  rows.push(['Cash', cash], ['UPI', upi], ['Total collected', cash + upi], ['Credits sold', creditsSold])
  rows.push([])
  rows.push(['LEVEL-WISE ATTENDANCE'])
  byTier.forEach((r) => rows.push([r.tier, r.count]))
  rows.push([])
  rows.push(['PAYMENTS'])
  rows.push(['Time', 'Member', 'Level', 'Club', 'Mobile', 'Credits', 'Amount', 'Method', 'Reference', 'Taken by'])
  payments.forEach((p) => {
    const m = memberById[p.memberId] || {}
    rows.push([
      fmtTime(p.createdAt), p.memberName || m.name || '', m.tier || '', m.clubName || '', m.mobile || '',
      p.credits ?? 0, p.amount ?? 0, p.method || '', p.ref || '', p.by?.label || '',
    ])
  })
  rows.push([])
  rows.push(['CHECKED IN'])
  rows.push(['Name', 'Level', 'Club', 'In', 'Out', 'Guests'])
  entries.forEach((e) => {
    const m = memberById[e.memberId] || {}
    rows.push([e.name || '', e.tier || m.tier || '', m.clubName || '', fmtTime(e.at), e.exitedAt ? fmtTime(e.exitedAt) : '', e.guests || 0])
  })
  rows.push([])
  rows.push(['DID NOT COME'])
  rows.push(['Name', 'Level', 'Club', 'Mobile', 'Credits left'])
  absent.forEach((m) => rows.push([m.name || '', m.tier || '', m.clubName || '', m.mobile || '', m.credits || 0]))

  const csv = rows.map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }))
  a.download = `end-of-day-${date}.csv`
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
