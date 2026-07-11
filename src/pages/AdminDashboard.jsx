import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { CURRENCY } from '../config'
import { clearAccess } from '../lib/access'
import { chime, primeAudio } from '../lib/feedback'
import { confetti } from '../lib/celebrate'
import CountUp from '../components/CountUp'
import {
  subscribeActiveSession,
  subscribeSessionBookings,
  subscribeMembers,
  startSession,
  endSession,
} from '../lib/db'

export default function AdminDashboard() {
  const { logout, isSuper } = useAuth()
  const [session, setSession] = useState(null)
  const [bookings, setBookings] = useState([])
  const [members, setMembers] = useState([])
  const [busy, setBusy] = useState(false)
  const [muted, setMuted] = useState(() => localStorage.getItem('admin_mute') === '1')
  const [view, setView] = useState('stream')
  const [gateFilter, setGateFilter] = useState('all')
  const [, setTick] = useState(0)

  useEffect(() => subscribeActiveSession(setSession), [])
  useEffect(() => subscribeMembers(setMembers), [])
  useEffect(() => (session ? subscribeSessionBookings(session.id, setBookings) : undefined), [session])

  // Keep the clock + momentum windows fresh even when nothing is scanned.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30000)
    return () => clearInterval(id)
  }, [])

  const checkedIn = useMemo(
    () =>
      bookings
        .filter((b) => b.status === 'checked_in')
        .sort((a, b) => (a.checkedInAt?.seconds || 0) - (b.checkedInAt?.seconds || 0)),
    [bookings],
  )
  const pending = useMemo(() => bookings.filter((b) => b.status === 'pending'), [bookings])
  const memberById = useMemo(() => Object.fromEntries(members.map((m) => [m.id, m])), [members])

  const attendees = checkedIn.reduce((n, b) => n + (b.peopleCount || 0), 0)
  const capacity = session?.capacity ?? 0
  const occupancyPct = capacity ? Math.min(100, Math.round((attendees / capacity) * 100)) : 0
  const remaining = Math.max(0, capacity - attendees)
  const expectedPeople = pending.reduce((n, b) => n + (b.peopleCount || 0), 0)
  const revenue = checkedIn.reduce((n, b) => n + (b.totalAmount || 0), 0)
  const expectedRevenue = pending.reduce((n, b) => n + (b.totalAmount || 0), 0)
  const guests = checkedIn.reduce((n, b) => n + (b.people?.filter((p) => p.isGuest).length || 0), 0)
  const groups = checkedIn.length
  const insideNow = checkedIn.filter((b) => !b.exitedAt).reduce((n, b) => n + (b.peopleCount || 0), 0)
  const leftCount = attendees - insideNow

  // 5-minute time buckets for momentum + sparklines.
  const nowSec = Math.floor(Date.now() / 1000)
  const BIN = 300
  const nowBin = Math.floor(nowSec / BIN)
  const N = 12
  const peopleBins = {}
  const revBins = {}
  checkedIn.forEach((b) => {
    const s = b.checkedInAt?.seconds
    if (!s) return
    const k = Math.floor(s / BIN)
    peopleBins[k] = (peopleBins[k] || 0) + (b.peopleCount || 0)
    revBins[k] = (revBins[k] || 0) + (b.totalAmount || 0)
  })
  const peopleSeries = []
  const revSeries = []
  let cum = 0
  for (let i = N - 1; i >= 0; i--) {
    const k = nowBin - i
    peopleSeries.push(peopleBins[k] || 0)
    cum += revBins[k] || 0
    revSeries.push(cum)
  }
  const T = 600
  const momentumNow = checkedIn
    .filter((b) => b.checkedInAt && nowSec - b.checkedInAt.seconds <= T)
    .reduce((n, b) => n + b.peopleCount, 0)
  const momentumPrev = checkedIn
    .filter((b) => b.checkedInAt && nowSec - b.checkedInAt.seconds > T && nowSec - b.checkedInAt.seconds <= 2 * T)
    .reduce((n, b) => n + b.peopleCount, 0)
  const momentumUp = momentumNow >= momentumPrev
  let peak = null
  Object.entries(peopleBins).forEach(([k, v]) => {
    if (!peak || v > peak.v) peak = { k: Number(k), v }
  })
  const peakLabel = peak && peak.v > 0 ? `Peak ${fmtHM(peak.k * BIN)} · ${peak.v} in` : null

  // Per-gate split (+ last person through each gate).
  const gateMap = {}
  const gateLast = {}
  checkedIn.forEach((b) => {
    const g = b.gate ? String(b.gate) : 'Unassigned'
    gateMap[g] = (gateMap[g] || 0) + (b.peopleCount || 0)
    gateLast[g] = b
  })
  const gates = Object.keys(gateMap).sort()

  // Alerts (only the ones buildable from admin-side data).
  const lowBalanceFlags = pending.filter((b) => (memberById[b.memberId]?.balance || 0) < (b.totalAmount || 0))
  const alerts = []
  if (capacity) {
    const frac = remaining / capacity
    if (frac < 0.05) alerts.push({ level: 'red', text: `Only ${remaining} seats left` })
    else if (frac < 0.15) alerts.push({ level: 'amber', text: `${remaining} seats left` })
  }
  if (lowBalanceFlags.length) {
    alerts.push({ level: 'red', text: `${lowBalanceFlags.length} expected member${lowBalanceFlags.length > 1 ? 's' : ''} can't cover the fee` })
  }

  // Chime on new entry, prime audio, full-house confetti.
  const prevCount = useRef(null)
  useEffect(() => {
    const n = checkedIn.length
    if (prevCount.current === null) { prevCount.current = n; return }
    if (n > prevCount.current && !muted) chime()
    prevCount.current = n
  }, [checkedIn.length, muted])
  useEffect(() => {
    const prime = () => primeAudio()
    window.addEventListener('pointerdown', prime, { once: true })
    return () => window.removeEventListener('pointerdown', prime)
  }, [])
  const celebrated = useRef(false)
  useEffect(() => {
    if (occupancyPct >= 100 && attendees > 0 && !celebrated.current) {
      celebrated.current = true
      confetti(60)
    }
    if (occupancyPct < 100) celebrated.current = false
  }, [occupancyPct, attendees])

  function toggleMute() {
    const v = !muted
    setMuted(v)
    localStorage.setItem('admin_mute', v ? '1' : '0')
  }
  async function start() {
    setBusy(true)
    try { await startSession() } finally { setBusy(false) }
  }
  async function handleEnd() {
    if (!session) return
    const ok = window.confirm(
      'End the current session?\n\nThis resets the live count and cancels any un-scanned bookings (members get their held balance back). Next Saturday starts fresh.',
    )
    if (!ok) return
    setBusy(true)
    try { await endSession(session.id) } finally { setBusy(false) }
  }

  const startSec = session?.createdAt?.seconds
  const clock = startSec ? `${fmtHM(startSec)} · ${Math.max(0, Math.floor((nowSec - startSec) / 60))}m` : 'starting…'

  const lockOrLogout = isSuper ? (
    <button className="btn ghost small" onClick={logout}>Log out</button>
  ) : (
    <button className="btn ghost small" onClick={() => { clearAccess('admin'); window.location.reload() }}>Lock</button>
  )

  if (!session) {
    return (
      <div className="page wide">
        <header className="topbar">
          <div className="brand"><span className="leaf">🌿</span>Admin · Saturday Training</div>
          <div className="row gap">
            {isSuper && <Link className="btn ghost small" to="/super">Super Admin</Link>}
            {lockOrLogout}
          </div>
        </header>
        <div className="card center-text">
          <div className="empty"><span className="ico">📋</span><div className="t">No active session</div><div className="small">Start a session to open the door.</div></div>
          <button className="btn primary" onClick={start} disabled={busy}>{busy ? 'Starting…' : 'Start session'}</button>
        </div>
      </div>
    )
  }

  const arrivedW = capacity ? Math.min(100, (attendees / capacity) * 100) : 0
  const expectedW = capacity ? Math.min(100, ((attendees + expectedPeople) / capacity) * 100) : 0
  const stream = [...checkedIn].reverse().filter((b) => gateFilter === 'all' || (b.gate ? String(b.gate) : 'Unassigned') === gateFilter)

  return (
    <div className="page wide cmd">
      <header className="cmdbar">
        <div className="brand"><span className="leaf">🌿</span>Command Center</div>
        <div className="live-pill"><span className="live-dot" />LIVE · {clock}</div>
        <div className="row gap cmd-actions">
          {isSuper && <Link className="btn ghost small" to="/super">Super Admin</Link>}
          <Link className="btn ghost small" to="/admin/credits">Credits</Link>
          <Link className="btn ghost small" to="/admin/report">Report</Link>
          <Link className="btn ghost small" to="/door?gate=1" target="_blank">Door 1</Link>
          <Link className="btn ghost small" to="/door?gate=2" target="_blank">Door 2</Link>
          <Link className="btn ghost small" to="/scan?gate=1" target="_blank">Open scanner</Link>
          <button className="btn ghost small" onClick={toggleMute} title="Entry sound">{muted ? '🔕' : '🔔'}</button>
          <button className="btn danger small" onClick={handleEnd} disabled={busy}>End session</button>
          {lockOrLogout}
        </div>
      </header>

      <section className="hero hero-cmd">
        <div className="hc">
          <span className="hc-halo" />
          <div className="hc-num"><CountUp value={attendees} /></div>
          <div className="hc-sub">of {capacity} seats</div>
          <div className="mini-stats">
            <span><b>{insideNow}</b> inside</span>
            <span><b>{leftCount}</b> left</span>
            <span><b>{guests}</b> guests</span>
            <span><b>{expectedPeople}</b> expected</span>
          </div>
        </div>
        <div className="caprail-wrap">
          <div className="caprail">
            <div className="caprail-expected" style={{ width: `${expectedW}%` }} />
            <div className={`caprail-arrived ${occupancyPct >= 90 ? 'high' : ''}`} style={{ width: `${arrivedW}%` }} />
            <div className="caprail-notch" />
          </div>
          <div className="caprail-legend">
            <span className="strong">{occupancyPct}% full · {remaining} seats left</span>
            <span className="caprail-state">{occupancyPct >= 100 ? '🎉 Full house' : occupancyPct >= 90 ? 'Almost full' : `${expectedPeople} still walking in`}</span>
          </div>
        </div>
      </section>

      {alerts.length > 0 && (
        <div className="alert-lane">
          {alerts.map((a, i) => <span key={i} className={`alert-chip ${a.level}`}>⚠ {a.text}</span>)}
        </div>
      )}

      <section className="vitals">
        <div className="vital money">
          <div className="vital-label">Revenue collected</div>
          <div className="vital-val"><CountUp value={revenue} prefix={CURRENCY} /></div>
          <Sparkline data={revSeries} color="var(--gold)" />
          <div className="vital-sub">{CURRENCY}{expectedRevenue} still expected</div>
        </div>
        <div className="vital">
          <div className="vital-label">Momentum · 10 min</div>
          <div className="vital-val">{momentumNow} <span className={momentumUp ? 'pos' : 'neg'}>{momentumUp ? '▲' : '▼'}</span></div>
          <Sparkline data={peopleSeries} color="var(--brand)" />
          <div className="vital-sub">{peakLabel || 'building…'}</div>
        </div>
        <div className="vital">
          <div className="vital-label">Still expected</div>
          <div className="vital-val">{pending.length}</div>
          <div className="vital-sub">{expectedPeople} people yet to arrive</div>
        </div>
        <div className="vital">
          <div className="vital-label">By gate</div>
          <div className="gatebars">
            {gates.length === 0 && <div className="muted small">No entries yet</div>}
            {gates.map((g) => (
              <div className="gatebar" key={g}>
                {gateLast[g]?.people?.[0]?.photoURL
                  ? <img className="gate-face" src={gateLast[g].people[0].photoURL} alt="" />
                  : <span className="gate-face fb">{(gateLast[g]?.memberName || '?')[0]}</span>}
                <span className="gatebar-label">{g === 'Unassigned' ? g : `Gate ${g}`}</span>
                <div className="gatebar-track"><div className="gatebar-fill" style={{ width: pctW(gateMap[g], attendees) }} /></div>
                <span className="gatebar-n">{gateMap[g]}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="card">
        <div className="row between" style={{ flexWrap: 'wrap', gap: 10 }}>
          <h3 style={{ margin: 0 }}>Live entry stream</h3>
          <div className="row gap">
            {gates.length > 1 && (
              <div className="chipset">
                <button className={`chip ${gateFilter === 'all' ? 'on' : ''}`} onClick={() => setGateFilter('all')}>All</button>
                {gates.map((g) => <button key={g} className={`chip ${gateFilter === g ? 'on' : ''}`} onClick={() => setGateFilter(g)}>{g === 'Unassigned' ? g : `Gate ${g}`}</button>)}
              </div>
            )}
            <div className="seg">
              <button className={view === 'stream' ? 'on' : ''} onClick={() => setView('stream')}>Stream</button>
              <button className={view === 'grid' ? 'on' : ''} onClick={() => setView('grid')}>Grid</button>
            </div>
          </div>
        </div>

        {checkedIn.length === 0 && (
          <div className="empty"><span className="ico">🚪</span><div className="t">No one has entered yet</div><div className="small">Entries appear here live as people are scanned in.</div></div>
        )}

        {checkedIn.length > 0 && view === 'stream' && (
          <div className="stream">
            {stream.map((b) => (
              <div className="stream-row" key={b.id}>
                <span className="seq">{checkedIn.indexOf(b) + 1}</span>
                <div className="feed-faces">
                  {b.people.map((p, j) => p.photoURL ? <img key={j} src={p.photoURL} alt="" /> : <div key={j} className="avatar-fallback sm">{(p.name || '?')[0]}</div>)}
                </div>
                <div className="stream-body">
                  <div className="feed-card-name">{b.memberName} {b.exitedAt && <span className="left-tag">left</span>}</div>
                  <div className="muted small">{b.peopleCount} {b.peopleCount > 1 ? 'people' : 'person'} · gate {b.gate || '—'}</div>
                </div>
                <div className="stream-meta">
                  <div className="feed-time">🕘 {fmtTime(b.checkedInAt)}{b.exitedAt ? ` → ${fmtTime(b.exitedAt)}` : ''}</div>
                  <div className="muted small">−{CURRENCY}{b.totalAmount}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {checkedIn.length > 0 && view === 'grid' && (
          <div className="feed-grid">
            {stream.map((b) => (
              <div key={b.id} className="feed-card">
                <div className="feed-card-top"><span className="seq">{checkedIn.indexOf(b) + 1}</span><span className="muted small">−{CURRENCY}{b.totalAmount}</span></div>
                <div className="feed-faces">{b.people.map((p, j) => p.photoURL ? <img key={j} src={p.photoURL} alt="" /> : <div key={j} className="avatar-fallback sm">{(p.name || '?')[0]}</div>)}</div>
                <div><div className="feed-card-name">{b.memberName}</div><div className="muted small">{b.peopleCount} {b.peopleCount > 1 ? 'people' : 'person'}{b.gate ? ` · gate ${b.gate}` : ''}</div></div>
                <div className="feed-time">🕘 {fmtTime(b.checkedInAt)}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function Sparkline({ data, color = 'var(--brand)' }) {
  if (!data || data.length < 2 || Math.max(...data) === 0) return <div className="spark-empty" />
  const max = Math.max(1, ...data)
  const step = 100 / (data.length - 1)
  const pts = data.map((v, i) => `${(i * step).toFixed(1)},${(26 - (v / max) * 24).toFixed(1)}`).join(' ')
  return (
    <svg className="spark" viewBox="0 0 100 28" preserveAspectRatio="none">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

function fmtTime(ts) {
  if (!ts?.seconds) return '⏳ syncing'
  return new Date(ts.seconds * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
function fmtHM(sec) {
  return new Date(sec * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
function pctW(v, total) {
  return `${total ? Math.min(100, Math.round((v / total) * 100)) : 0}%`
}
