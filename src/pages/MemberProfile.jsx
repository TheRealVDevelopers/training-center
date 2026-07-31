import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { CURRENCY, TIERS, PACK_CREDITS, packPrice } from '../config'
import {
  getMember,
  subscribeMemberEntries,
  subscribeMemberHistory,
  subscribeSessions,
  updateMemberProfile,
  recharge,
  adjustCredits,
  replaceToken,
} from '../lib/db'
import { attendanceOf, riskOf, RISK_LABEL } from '../lib/attendance'
import { waLink } from '../components/OwnerOnly'
import ThemeToggle from '../components/ThemeToggle'

// F4 — one member's whole story: who they are, every Saturday they came or
// missed, what they paid, where their card is. Owner-only.
export default function MemberProfile() {
  const { id } = useParams()
  const [member, setMember] = useState(undefined)
  const [entries, setEntries] = useState([])
  const [txns, setTxns] = useState([])
  const [sessions, setSessions] = useState([])
  const [msg, setMsg] = useState('')
  const [packs, setPacks] = useState(1)
  const [method, setMethod] = useState('cash')
  const [adj, setAdj] = useState('')

  useEffect(() => { getMember(id).then(setMember) }, [id])
  useEffect(() => subscribeMemberEntries(id, setEntries), [id])
  useEffect(() => subscribeMemberHistory(id, setTxns), [id])
  useEffect(() => subscribeSessions(setSessions, 120), [])

  // Keep the header numbers live after a recharge without a page reload.
  useEffect(() => {
    if (!member) return undefined
    const t = setInterval(() => getMember(id).then((m) => m && setMember(m)), 4000)
    return () => clearInterval(t)
  }, [id, member?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const att = useMemo(
    () => (member ? attendanceOf(member, sessions, entries) : null),
    [member, sessions, entries],
  )

  if (member === undefined) return <div className="center muted">Loading member…</div>
  if (!member) return <div className="center muted">Member not found.</div>

  const needed = member.couple ? 2 : 1
  const printed = Math.min(needed, member.printedCount ?? (member.cardPrinted ? needed : 0))
  const given = Math.min(needed, member.givenCount ?? (member.cardGiven ? needed : 0))
  const risk = att ? riskOf(att) : 'new'
  const paid = txns.filter((t) => t.type === 'recharge' || t.type === 'topup')
    .reduce((n, t) => n + (t.amount || 0), 0)
  const used = txns.filter((t) => t.type === 'entry').length
  const wa = waLink(member.mobile, `Hi ${member.name?.split(' ')[0] || ''} 👋 See you this Saturday at training! 🌿`)

  function flash(t) { setMsg(t); setTimeout(() => setMsg(''), 3000) }
  async function doRecharge() {
    try {
      const r = await recharge(member.id, packs, { method })
      flash(`✓ +${r.credits} credits (${CURRENCY}${r.amount}) — balance ${r.total}`)
      getMember(id).then(setMember)
    } catch (e) { flash(e.message) }
  }
  async function doAdjust(sign) {
    const n = parseInt(adj, 10)
    if (!n) return
    try {
      const now = await adjustCredits(member.id, sign * n, `Owner adjustment ${sign > 0 ? '+' : '−'}${n}`)
      setAdj(''); flash(`✓ Balance now ${now} credits`)
      getMember(id).then(setMember)
    } catch (e) { flash(e.message) }
  }
  async function newCard() {
    if (!window.confirm(`Replace ${member.name}'s card & QR?\nThe old card and QR stop working immediately.`)) return
    await replaceToken(member.id)
    flash('✓ New token issued — print a new card and re-assign it')
    getMember(id).then(setMember)
  }
  async function saveTier(tier) {
    await updateMemberProfile(member.id, { tier, tierNeedsReview: false })
    flash(`✓ Level saved: ${tier}`)
    getMember(id).then(setMember)
  }

  // Month buckets for the present/absent list, newest month first.
  const months = useMemo(() => {
    if (!att) return []
    const map = new Map()
    for (const r of [...att.rows].reverse()) {
      const key = r.date.slice(0, 7)
      if (!map.has(key)) map.set(key, [])
      map.get(key).push(r)
    }
    return [...map.entries()]
  }, [att])

  return (
    <div className="page wide">
      <header className="topbar">
        <div>
          <div className="brand"><span className="leaf">🌿</span>Member</div>
          <div className="muted small">Full history · owner view</div>
        </div>
        <div className="row gap">
          <ThemeToggle />
          <Link className="btn ghost small" to="/owner">‹ Owner</Link>
        </div>
      </header>

      {/* 1 · Identity */}
      <div className="card mp-id">
        {member.photoURL
          ? <img className="mp-photo" src={member.photoURL} alt="" />
          : <span className="mp-photo fb">{(member.name || '?')[0]}</span>}
        <div className="mp-idbody">
          <div className="mp-name">{member.name}{member.couple ? ' 👫' : ''}</div>
          <div className="mp-sub">
            {member.tier || 'Associate'}{member.clubName ? ` · ${member.clubName}` : ''}
            {member.city ? ` · ${member.city}` : ''}
          </div>
          <div className="mp-sub muted">
            {member.mobile ? <a href={`tel:${member.mobile}`}>{member.mobile}</a> : 'no mobile'}
            {member.email ? ` · ${member.email}` : ''}
            {` · member no. ${(member.id || '').slice(-4).toUpperCase()}`}
            {member.createdAt?.seconds
              ? ` · since ${new Date(member.createdAt.seconds * 1000).toLocaleDateString([], { month: 'short', year: 'numeric' })}`
              : ''}
          </div>
        </div>
        <span className={`risk-pill ${risk}`}>{RISK_LABEL[risk]}</span>
      </div>

      {/* 2 · The four numbers */}
      <section className="mstats">
        <div className="mstat"><div className="mstat-val">{member.credits || 0}</div><div className="mstat-lbl">Credits left</div></div>
        <div className="mstat"><div className="mstat-val">{att?.pct == null ? '—' : `${att.pct}%`}</div><div className="mstat-lbl">Attendance</div></div>
        <div className="mstat"><div className="mstat-val">{att?.attended.length || 0}</div><div className="mstat-lbl">Total visits</div></div>
        <div className="mstat"><div className="mstat-val">{att?.streak || 0}{att?.streak >= 3 ? ' 🔥' : ''}</div><div className="mstat-lbl">Streak</div></div>
      </section>

      {/* 3 · The strip — the whole story in one row */}
      <div className="card">
        <div className="row between" style={{ flexWrap: 'wrap', gap: 8 }}>
          <h3 style={{ margin: 0 }}>Last {Math.min(16, att?.total || 0) || ''} Saturdays</h3>
          <span className="muted small">
            {att?.lastSeen ? `last seen ${fmtDay(att.lastSeen)}` : 'never attended yet'}
          </span>
        </div>
        {!att?.total ? (
          <div className="muted small" style={{ marginTop: 10 }}>
            New member — no Saturdays have happened since they joined yet.
          </div>
        ) : (
          <div className="mp-strip">
            {att.rows.slice(-16).map((r) => (
              <span key={r.session.id} className={`mp-dot ${r.present ? 'in' : 'out'}`} title={`${fmtDay(r.date)} — ${r.present ? 'attended' : 'absent'}`}>
                <span className="mp-dot-day">{r.date.slice(8)}</span>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* 4 · Present / absent, by month */}
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Attendance history</h3>
        {months.length === 0 && <div className="muted small">Nothing yet — their first Saturday is still to come.</div>}
        {months.map(([key, rows]) => {
          const came = rows.filter((r) => r.present).length
          return (
            <div key={key} className="mp-month">
              <div className="mp-month-head">
                <b>{fmtMonth(key)}</b>
                <span className="muted small">{came} of {rows.length}</span>
              </div>
              {rows.map((r) => (
                <div key={r.session.id} className={`mp-row ${r.present ? '' : 'absent'}`}>
                  <span className="mp-mark">{r.present ? '✓' : '✗'}</span>
                  <span className="mp-date">{fmtDay(r.date)}</span>
                  <span className="mp-detail">
                    {r.present
                      ? `In ${fmtTime(r.entry.at)}${r.entry.exitedAt ? ` → left ${fmtTime(r.entry.exitedAt)}` : ''}`
                        + `${r.entry.guests ? ` · +${r.entry.guests} guest${r.entry.guests > 1 ? 's' : ''}` : ''}`
                      : 'Absent'}
                  </span>
                  <Link className="mp-open" to={`/owner/session/${r.date}`}>›</Link>
                </div>
              ))}
            </div>
          )
        })}
      </div>

      {/* 5 · Money */}
      <div className="card">
        <div className="row between"><h3 style={{ margin: 0 }}>Money</h3>
          <span className="muted small">{CURRENCY}{paid} paid · {used} entries used</span></div>
        {txns.length === 0 && <div className="muted small" style={{ marginTop: 8 }}>No payments yet.</div>}
        <div style={{ marginTop: 8 }}>
          {txns.slice(0, 40).map((t) => (
            <div key={t.id} className="hist-row">
              <span className={`hist-ico ${(t.credits ?? t.amount) > 0 ? 'in' : 'out'}`}>{t.type === 'entry' ? '🎟️' : t.type === 'adjust' ? '⚖️' : '💳'}</span>
              <div className="hist-body">
                <div className="hist-title">{t.note || t.type}{t.method ? ` · ${t.method}` : ''}</div>
                <div className="muted small">{fmtDateTime(t.createdAt)}</div>
              </div>
              <div className={`hist-amt ${(t.credits ?? 0) >= 0 ? 'pos' : 'neg'}`}>
                {t.credits != null ? `${t.credits > 0 ? '+' : ''}${t.credits} cr` : ''}
                {t.amount ? ` ${CURRENCY}${t.amount}` : ''}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 6 · Card */}
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Card</h3>
        <div className="row gap wrap">
          <span className={`tag ${printed >= needed ? 'ok' : 'muted'}`}>printed {printed}/{needed}</span>
          <span className={`tag ${given >= needed ? 'ok' : 'muted'}`}>given {given}/{needed}</span>
          <span className="muted small">{member.cardUid ? `card ${member.cardUid}` : 'no card assigned yet'}</span>
        </div>
        <div className="row gap wrap" style={{ marginTop: 10 }}>
          <Link className="btn small" to={`/admin/print?m=${member.id}`} target="_blank">🖨 Print card</Link>
          <Link className="btn small" to="/admin/cards">📋 Tracking</Link>
          <button className="btn small" onClick={newCard}>♻ Replace card / QR</button>
        </div>
      </div>

      {/* 7 · Actions */}
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Actions</h3>
        <div className="row gap wrap">
          <label className="inline">Level
            <select value={member.tier || 'Associate'} onChange={(e) => saveTier(e.target.value)}>
              {Object.keys(TIERS).map((t) => <option key={t} value={t}>{t} · {CURRENCY}{TIERS[t]}/{PACK_CREDITS}</option>)}
            </select>
          </label>
          <button className={`ct-toggle ${member.couple ? 'on couple' : ''}`}
            onClick={() => updateMemberProfile(member.id, { couple: !member.couple }).then(() => getMember(id).then(setMember))}>
            {member.couple ? '👫 ×2 couple' : '×1 single'}
          </button>
        </div>
        <div className="row gap wrap" style={{ marginTop: 12 }}>
          {[1, 2].map((p) => (
            <button key={p} className={`amt-chip ${packs === p ? 'on' : ''}`} onClick={() => setPacks(p)}>
              {p * PACK_CREDITS} cr · {CURRENCY}{packPrice(member.tier) * p}
            </button>
          ))}
          <select value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="cash">Cash</option><option value="upi">UPI</option>
          </select>
          <button className="btn small primary" onClick={doRecharge}>Recharge</button>
          <span className="row gap" style={{ marginLeft: 'auto' }}>
            <input inputMode="numeric" placeholder="±cr" value={adj}
              onChange={(e) => setAdj(e.target.value.replace(/\D/g, ''))} style={{ width: 70 }} />
            <button className="btn small" onClick={() => doAdjust(1)}>+</button>
            <button className="btn small" onClick={() => doAdjust(-1)}>−</button>
          </span>
        </div>
        {wa && (
          <a className="btn block" href={wa} target="_blank" rel="noreferrer" style={{ marginTop: 12 }}>
            💬 WhatsApp {member.name?.split(' ')[0]}
          </a>
        )}
        {msg && <div className="banner">{msg}</div>}
      </div>
    </div>
  )
}

function fmtDay(date) {
  const [y, m, d] = String(date).split('-').map(Number)
  if (!y) return date
  return new Date(y, m - 1, d).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })
}
function fmtMonth(key) {
  const [y, m] = key.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString([], { month: 'long', year: 'numeric' })
}
function fmtTime(ts) {
  if (!ts?.seconds) return '—'
  return new Date(ts.seconds * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
function fmtDateTime(ts) {
  if (!ts?.seconds) return 'just now'
  const d = new Date(ts.seconds * 1000)
  return `${d.toLocaleDateString([], { day: 'numeric', month: 'short' })} · ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
}
