import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { signInWithEmailAndPassword, sendPasswordResetEmail } from 'firebase/auth'
import { auth } from '../firebase'
import { useAuth } from '../auth/AuthContext'
import { CURRENCY, TIERS, PACK_CREDITS, packPrice } from '../config'
import ThemeToggle from '../components/ThemeToggle'
import {
  subscribeMembers,
  subscribeActiveSession,
  subscribeSessionEntries,
  subscribeSessions,
  subscribeAllPayments,
  updateMemberProfile,
  addMemberDirect,
  recharge,
  adjustCredits,
  deletePayment,
  replaceToken,
  setStaffPin,
  subscribeSettings,
} from '../lib/db'

// The owner's ONE page. Four tabs: Today · People · Money · Print.
// Owner email login only — staff never need this page.
export default function Owner() {
  const { user, loading, logout, isSuper } = useAuth()
  if (loading) return <div className="center muted">Loading…</div>
  if (!user || user.isAnonymous) return <OwnerLogin />
  if (!isSuper) {
    return (
      <div className="center">
        <div className="card narrow center-text">
          <h3>Owner only</h3>
          <p className="muted">You're signed in as {user.email}. This page is for the owner's account.</p>
          <button className="btn block" onClick={logout}>Log out</button>
        </div>
      </div>
    )
  }
  return <OwnerHub logout={logout} />
}

function OwnerLogin() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(e) {
    e.preventDefault()
    setErr('')
    setBusy(true)
    try { await signInWithEmailAndPassword(auth, email.trim(), password) }
    catch (er) { setErr(er.message); setBusy(false) }
  }
  return (
    <div className="center">
      <form className="card narrow" onSubmit={submit}>
        <div className="brand"><span className="leaf">🌿</span> Owner</div>
        <p className="muted">Owner login only.</p>
        <label>Email</label>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <label>Password</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        {err && <div className="error">{err}</div>}
        <button className="btn primary block" disabled={busy}>{busy ? 'Logging in…' : 'Log in'}</button>
      </form>
    </div>
  )
}

function OwnerHub({ logout }) {
  const [tab, setTab] = useState('today')
  const [members, setMembers] = useState([])
  useEffect(() => subscribeMembers(setMembers), [])

  return (
    <div className="page wide">
      <header className="topbar">
        <div>
          <div className="brand"><span className="leaf">🌿</span>Owner</div>
          <div className="muted small">Saturday Training</div>
        </div>
        <div className="row gap">
          <ThemeToggle />
          <Link className="btn ghost small" to="/admin">🖥 Reception</Link>
          <button className="btn ghost small" onClick={logout}>Log out</button>
        </div>
      </header>

      <div className="seg ownertabs">
        {[['today', '📊 Today'], ['people', '👥 People'], ['money', '💰 Money'], ['print', '🖨 Print']].map(([k, label]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>

      {tab === 'today' && <TodayTab members={members} />}
      {tab === 'people' && <PeopleTab members={members} />}
      {tab === 'money' && <MoneyTab members={members} />}
      {tab === 'print' && <PrintTab members={members} />}
    </div>
  )
}

// ---- TODAY -----------------------------------------------------------------
function TodayTab({ members }) {
  const [session, setSession] = useState(null)
  const [entries, setEntries] = useState([])
  const [sessions, setSessions] = useState([])
  const [payments, setPayments] = useState([])
  const [settings, setSettings] = useState({})
  const [pin, setPin] = useState('')
  const [pinMsg, setPinMsg] = useState('')

  useEffect(() => subscribeActiveSession(setSession), [])
  useEffect(() => (session ? subscribeSessionEntries(session.id, setEntries) : setEntries([]) || undefined), [session])
  useEffect(() => subscribeSessions(setSessions, 12), [])
  useEffect(() => subscribeAllPayments(setPayments), [])
  useEffect(() => subscribeSettings(setSettings), [])

  const inside = entries.filter((e) => !e.exitedAt).reduce((n, e) => n + 1 + (e.guests || 0), 0)
  const today = entries.reduce((n, e) => n + 1 + (e.guests || 0), 0)
  const midnight = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime() / 1000 }, [])
  const payToday = payments.filter((p) => (p.createdAt?.seconds || 0) >= midnight)
  const cash = payToday.filter((p) => p.method === 'cash').reduce((n, p) => n + (p.amount || 0), 0)
  const upi = payToday.filter((p) => p.method === 'upi').reduce((n, p) => n + (p.amount || 0), 0)
  const lowCount = members.filter((m) => (m.credits || 0) < 1).length

  async function savePin() {
    if (pin.length !== 4) return
    await setStaffPin(pin)
    setPin('')
    setPinMsg('✓ PIN updated — every staff device must enter the new one.')
    setTimeout(() => setPinMsg(''), 3500)
  }

  return (
    <>
      <section className="mstats">
        <div className="mstat"><div className="mstat-val">{inside}</div><div className="mstat-lbl">Inside now</div></div>
        <div className="mstat"><div className="mstat-val">{today}</div><div className="mstat-lbl">Entered today</div></div>
        <div className="mstat"><div className="mstat-val">{CURRENCY}{cash + upi}</div><div className="mstat-lbl">Collected today</div></div>
        <div className="mstat"><div className="mstat-val" style={{ color: lowCount ? 'var(--danger)' : undefined }}>{lowCount}</div><div className="mstat-lbl">Zero credits</div></div>
      </section>

      <div className="card">
        <div className="row between"><h3 style={{ margin: 0 }}>💰 Today's money</h3><span className="muted small">{payToday.length} recharge{payToday.length === 1 ? '' : 's'}</span></div>
        <div className="an-pay">
          <div className="an-pay-cell"><span className="an-pay-lbl">💵 Cash — should be in the drawer</span><span className="an-pay-val">{CURRENCY}{cash}</span></div>
          <div className="an-pay-cell"><span className="an-pay-lbl">📲 UPI — lands in the bank</span><span className="an-pay-val">{CURRENCY}{upi}</span></div>
          <div className="an-pay-cell total"><span className="an-pay-lbl">Total</span><span className="an-pay-val">{CURRENCY}{cash + upi}</span></div>
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Who entered today</h3>
        {entries.length === 0 && <div className="muted small">No entries yet{session ? '' : ' — the session starts with the first tap'}.</div>}
        {[...entries].sort((a, b) => (b.at?.seconds || 0) - (a.at?.seconds || 0)).map((e) => (
          <div key={e.id} className="hist-row">
            {e.photoURL ? <img className="avatar xs" src={e.photoURL} alt="" /> : <span className="avatar-fallback sm">{(e.name || '?')[0]}</span>}
            <div className="hist-body">
              <div className="hist-title">{e.name}{e.couple ? ' 👫' : ''}{e.guests ? ` +${e.guests} guest${e.guests > 1 ? 's' : ''}` : ''}</div>
              <div className="muted small">In {fmtT(e.at)}{e.exitedAt ? ` · left ${fmtT(e.exitedAt)}` : ''}</div>
            </div>
            <span className={`tag ${e.exitedAt ? 'muted' : 'ok'}`}>{e.exitedAt ? 'left' : 'inside'}</span>
          </div>
        ))}
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Past Saturdays</h3>
        {sessions.filter((s) => s.status === 'ended').length === 0 && <div className="muted small">Finished sessions appear here.</div>}
        {sessions.filter((s) => s.status === 'ended').map((s) => (
          <PastSession key={s.id} session={s} />
        ))}
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>🔒 Staff PIN</h3>
        <p className="muted small">Staff devices type this once and are remembered. Change it to lock every device out instantly. Current: <b>{settings.staffPin ? 'set' : 'not set — staff pages are open'}</b></p>
        <div className="row gap">
          <input inputMode="numeric" maxLength={4} placeholder="New 4-digit PIN" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} style={{ maxWidth: 180 }} />
          <button className="btn" disabled={pin.length !== 4} onClick={savePin}>Save</button>
        </div>
        {pinMsg && <div className="banner">{pinMsg}</div>}
      </div>
    </>
  )
}

function PastSession({ session }) {
  const [entries, setEntries] = useState([])
  useEffect(() => subscribeSessionEntries(session.id, setEntries), [session.id])
  const people = entries.reduce((n, e) => n + 1 + (e.guests || 0), 0)
  const day = session.startedAt?.seconds
    ? new Date(session.startedAt.seconds * 1000).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })
    : '—'
  return (
    <div className="hist-row">
      <span className="hist-ico in">📅</span>
      <div className="hist-body"><div className="hist-title">{day}</div></div>
      <b>{people} attended</b>
    </div>
  )
}

// ---- PEOPLE ----------------------------------------------------------------
function PeopleTab({ members }) {
  const [search, setSearch] = useState('')
  const [openId, setOpenId] = useState(null)
  const [adding, setAdding] = useState(false)

  const list = useMemo(() => {
    const q = search.trim().toLowerCase()
    return members
      .filter((m) => !q || (m.name || '').toLowerCase().includes(q) || (m.mobile || '').includes(q))
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
  }, [members, search])

  const couples = members.filter((m) => m.couple).length
  const review = members.filter((m) => m.tierNeedsReview).length

  return (
    <>
      <section className="mstats">
        <div className="mstat"><div className="mstat-val">{members.length}</div><div className="mstat-lbl">Members</div></div>
        <div className="mstat"><div className="mstat-val">{members.length + couples}</div><div className="mstat-lbl">Cards needed ({couples} couples)</div></div>
        <div className="mstat"><div className="mstat-val">{members.filter((m) => m.cardGiven).length}</div><div className="mstat-lbl">Cards given</div></div>
        {review > 0 && <div className="mstat"><div className="mstat-val" style={{ color: 'var(--warn)' }}>{review}</div><div className="mstat-lbl">Level to review</div></div>}
      </section>

      <div className="card">
        <div className="row between" style={{ gap: 10, flexWrap: 'wrap' }}>
          <input placeholder="Search name or mobile…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ flex: 1, minWidth: 200 }} />
          <button className="btn primary" onClick={() => setAdding(true)}>+ Add member</button>
        </div>
        <div className="memberlist">
          {list.map((m) => (
            <PersonRow key={m.id} m={m} open={openId === m.id} onToggle={() => setOpenId(openId === m.id ? null : m.id)} />
          ))}
          {list.length === 0 && <div className="muted small">No members match.</div>}
        </div>
      </div>

      {adding && <AddMemberPanel onClose={() => setAdding(false)} />}
    </>
  )
}

function PersonRow({ m, open, onToggle }) {
  const [msg, setMsg] = useState('')
  const [packs, setPacks] = useState(1)
  const [method, setMethod] = useState('cash')
  const [adj, setAdj] = useState('')

  async function save(patch, note) {
    try { await updateMemberProfile(m.id, patch); if (note) flash(note) } catch (e) { flash(e.message) }
  }
  function flash(t) { setMsg(t); setTimeout(() => setMsg(''), 2500) }

  async function doRecharge() {
    try {
      const r = await recharge(m.id, packs, { method })
      flash(`✓ +${r.credits} credits (${CURRENCY}${r.amount}) — balance ${r.total}`)
    } catch (e) { flash(e.message) }
  }
  async function doAdjust(sign) {
    const n = parseInt(adj, 10)
    if (!n) return
    try {
      const now = await adjustCredits(m.id, sign * n, `Owner adjustment ${sign > 0 ? '+' : '−'}${n}`)
      setAdj('')
      flash(`✓ Balance now ${now} credits`)
    } catch (e) { flash(e.message) }
  }
  async function newCard() {
    if (!window.confirm(`Replace ${m.name}'s card & QR? The old ones stop working immediately.`)) return
    await replaceToken(m.id)
    flash('✓ New token — print a new card / re-assign')
  }
  async function resetPw() {
    if (!m.email) { flash('No email on this member'); return }
    try { await sendPasswordResetEmail(auth, m.email); flash(`✓ Reset link emailed to ${m.email}`) } catch (e) { flash(e.message) }
  }

  return (
    <div className={`memberrow stack ${open ? 'sel' : ''}`}>
      <button className="prow-main" onClick={onToggle}>
        <span>
          {m.photoURL ? <img className="avatar xs" src={m.photoURL} alt="" /> : <span className="avatar-fallback sm">{(m.name || '?')[0]}</span>}
          <span className="mname">{m.name}{m.couple ? ' 👫' : ''}</span>
          <span className="muted small"> · {m.tier}{m.tierNeedsReview ? ' ⚠' : ''}</span>
        </span>
        <span className="strong">{m.credits || 0} cr</span>
      </button>
      {open && (
        <div className="prow-detail">
          <div className="row gap wrap">
            <label className="inline">Level
              <select value={m.tier || ''} onChange={(e) => save({ tier: e.target.value, tierNeedsReview: false }, '✓ Level saved')}>
                {Object.keys(TIERS).map((t) => <option key={t} value={t}>{t} · {CURRENCY}{TIERS[t]}/{PACK_CREDITS}</option>)}
              </select>
            </label>
            <button className={`ct-toggle ${m.couple ? 'on couple' : ''}`} onClick={() => save({ couple: !m.couple })}>{m.couple ? '👫 ×2 couple' : '×1'}</button>
            <button className={`ct-toggle ${m.cardPrinted ? 'on printed' : ''}`} onClick={() => save({ cardPrinted: !m.cardPrinted })}>{m.cardPrinted ? '✓ Printed' : 'Printed?'}</button>
            <button className={`ct-toggle ${m.cardGiven ? 'on given' : ''}`} onClick={() => save({ cardGiven: !m.cardGiven })}>{m.cardGiven ? '✓ Given' : 'Given?'}</button>
          </div>

          <div className="row gap wrap" style={{ marginTop: 10 }}>
            {[1, 2].map((p) => (
              <button key={p} className={`amt-chip ${packs === p ? 'on' : ''}`} onClick={() => setPacks(p)}>{p * PACK_CREDITS} cr · {CURRENCY}{packPrice(m.tier) * p}</button>
            ))}
            <select value={method} onChange={(e) => setMethod(e.target.value)}>
              <option value="cash">Cash</option><option value="upi">UPI</option>
            </select>
            <button className="btn small primary" onClick={doRecharge}>Recharge</button>
            <span className="row gap" style={{ marginLeft: 'auto' }}>
              <input inputMode="numeric" placeholder="±cr" value={adj} onChange={(e) => setAdj(e.target.value.replace(/\D/g, ''))} style={{ width: 64 }} />
              <button className="btn small" onClick={() => doAdjust(1)}>+</button>
              <button className="btn small" onClick={() => doAdjust(-1)}>−</button>
            </span>
          </div>

          <div className="row gap wrap" style={{ marginTop: 10 }}>
            <Link className="btn small" to={`/admin/print?m=${m.id}`} target="_blank">🖨 Print card</Link>
            <button className="btn small" onClick={newCard}>♻ Replace card/QR</button>
            <button className="btn small" onClick={resetPw}>✉ Password reset</button>
            <span className="muted small" style={{ alignSelf: 'center' }}>
              {m.mobile || 'no mobile'}{m.cardUid ? ` · card ${m.cardUid}` : ' · no card yet'}{m.noLogin ? ' · no login' : ''}
            </span>
          </div>
          {msg && <div className="banner">{msg}</div>}
        </div>
      )}
    </div>
  )
}

function AddMemberPanel({ onClose }) {
  const [f, setF] = useState({ name: '', mobile: '', clubName: '', tier: 'Associate', couple: false })
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState('')
  async function save() {
    if (!f.name.trim()) return
    setBusy(true)
    try {
      await addMemberDirect(f)
      setDone(`✓ ${f.name} added — assign a card from Reception → Find member.`)
      setTimeout(onClose, 1800)
    } catch (e) { setDone(e.message); setBusy(false) }
  }
  return (
    <div className="recharge-overlay" onClick={onClose}>
      <div className="recharge-panel" onClick={(e) => e.stopPropagation()}>
        <div className="recharge-head"><div><div className="recharge-name">Add member</div><div className="muted small">No smartphone or email needed — the card still works.</div></div><button className="btn ghost small" onClick={onClose}>✕</button></div>
        {done ? <div className="banner">{done}</div> : (
          <>
            <label>Name *</label>
            <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus />
            <label>Mobile</label>
            <input value={f.mobile} onChange={(e) => setF({ ...f, mobile: e.target.value })} inputMode="tel" />
            <label>Club</label>
            <input value={f.clubName} onChange={(e) => setF({ ...f, clubName: e.target.value })} />
            <label>Level</label>
            <select value={f.tier} onChange={(e) => setF({ ...f, tier: e.target.value })}>
              {Object.keys(TIERS).map((t) => <option key={t} value={t}>{t} · {CURRENCY}{TIERS[t]}/{PACK_CREDITS}</option>)}
            </select>
            <label className="row gap" style={{ alignItems: 'center', marginTop: 8 }}>
              <input type="checkbox" checked={f.couple} onChange={(e) => setF({ ...f, couple: e.target.checked })} style={{ width: 'auto' }} />
              Couple — needs 2 cards
            </label>
            <button className="btn primary block" disabled={busy || !f.name.trim()} onClick={save}>{busy ? 'Adding…' : 'Add member'}</button>
          </>
        )}
      </div>
    </div>
  )
}

// ---- MONEY -----------------------------------------------------------------
function MoneyTab({ members }) {
  const [payments, setPayments] = useState([])
  const [busyId, setBusyId] = useState('')
  useEffect(() => subscribeAllPayments(setPayments), [])
  const byId = useMemo(() => Object.fromEntries(members.map((m) => [m.id, m])), [members])

  async function remove(p) {
    const back = p.credits ?? Math.floor((p.amount || 0) / 300)
    if (!window.confirm(`Delete this ${CURRENCY}${p.amount} payment?\n${back} credits come back off ${byId[p.memberId]?.name || 'the member'}'s balance. Can't be undone.`)) return
    setBusyId(p.id)
    try { await deletePayment(p.id) } catch (e) { alert(e.message) } finally { setBusyId('') }
  }

  const days = useMemo(() => {
    const map = new Map()
    for (const p of payments) {
      const d = p.createdAt?.seconds ? new Date(p.createdAt.seconds * 1000) : new Date()
      const key = d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })
      if (!map.has(key)) map.set(key, [])
      map.get(key).push(p)
    }
    return [...map.entries()]
  }, [payments])

  return (
    <>
      {days.length === 0 && <div className="card"><div className="muted small">Payments appear here as recharges happen.</div></div>}
      {days.map(([day, rows]) => {
        const cash = rows.filter((p) => p.method === 'cash').reduce((n, p) => n + (p.amount || 0), 0)
        const upi = rows.filter((p) => p.method === 'upi').reduce((n, p) => n + (p.amount || 0), 0)
        return (
          <div className="card" key={day}>
            <div className="row between" style={{ flexWrap: 'wrap', gap: 8 }}>
              <h3 style={{ margin: 0 }}>{day}</h3>
              <span className="muted small">💵 {CURRENCY}{cash} · 📲 {CURRENCY}{upi} · total <b>{CURRENCY}{cash + upi}</b></span>
            </div>
            <div style={{ marginTop: 10 }}>
              {rows.map((p) => (
                <div key={p.id} className="hist-row">
                  <span className={`method-pill ${p.method || 'other'}`}>{(p.method || '—').toUpperCase()}</span>
                  <div className="hist-body">
                    <div className="hist-title">{byId[p.memberId]?.name || 'Member'} · +{p.credits ?? Math.floor((p.amount || 0) / 300)} cr</div>
                    <div className="muted small">{fmtT(p.createdAt)}{p.ref ? ` · ${p.ref}` : ''}</div>
                  </div>
                  <b className="pos">+{CURRENCY}{p.amount}</b>
                  <button className="rl-del" disabled={busyId === p.id} onClick={() => remove(p)} title="Delete payment">🗑</button>
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </>
  )
}

// ---- PRINT -----------------------------------------------------------------
function PrintTab({ members }) {
  const toPrint = members.filter((m) => !m.cardPrinted).length
  const toGive = members.filter((m) => m.cardPrinted && !m.cardGiven).length
  return (
    <>
      <section className="mstats">
        <div className="mstat"><div className="mstat-val">{toPrint}</div><div className="mstat-lbl">Cards to print</div></div>
        <div className="mstat"><div className="mstat-val">{toGive}</div><div className="mstat-lbl">Printed, to give</div></div>
      </section>
      <div className="card">
        <h3 style={{ marginTop: 0 }}>🖨 Card Studio</h3>
        <p className="muted small">Pick a member — their level picks the card design — print. Mark Printed / Given on the People tab as you go.</p>
        <div className="actions">
          <Link className="btn big" to="/admin/print" target="_blank">Open Card Studio ›</Link>
          <Link className="btn big" to="/admin/cards" target="_blank">Card tracking — printed / given ›</Link>
          <Link className="btn big" to="/admin/testcard" target="_blank">Printer test page ›</Link>
          <Link className="btn big" to="/door" target="_blank">Door QR screen ›</Link>
          <Link className="btn big" to="/signup" target="_blank">Signup page (share) ›</Link>
          <Link className="btn big" to="/poster" target="_blank">Signup poster (print / WhatsApp) ›</Link>
        </div>
      </div>
    </>
  )
}

function fmtT(ts) {
  if (!ts?.seconds) return 'now'
  return new Date(ts.seconds * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
