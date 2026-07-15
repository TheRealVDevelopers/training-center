import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  subscribeActiveSession,
  subscribeSessionBookings,
  subscribeMembers,
  checkInMember,
  logScanEvent,
} from '../lib/db'
import { useLocalReader, sendReaderFeedback } from '../lib/localReader'
import { useWakeLock } from '../lib/wakeLock'
import { feedback, primeAudio } from '../lib/feedback'

// The registration PC's hub page. The PC/SC bridge feeds taps from all three
// wired ACS readers; this page routes them:
//   gate1 / gate2 -> check-in + reader LED (green/beep or red/double-beep)
//                    + a scanEvents log the door tablets stream live
//   desk          -> ignored here (AdminCredits captures desk taps when arming
//                    "assign card" / "tap to find member")
// Keep this page open on the PC whenever the venue is running.
export default function Station() {
  const [session, setSession] = useState(null)
  const [bookings, setBookings] = useState([])
  const [members, setMembers] = useState([])
  const [gates, setGates] = useState({}) // gate -> last result
  const [deskUid, setDeskUid] = useState('')

  const sessionRef = useRef(null)
  const membersRef = useRef([])
  const recent = useRef(new Map())

  useWakeLock(true)
  useEffect(() => subscribeActiveSession(setSession), [])
  useEffect(() => subscribeMembers(setMembers), [])
  useEffect(() => (session ? subscribeSessionBookings(session.id, setBookings) : undefined), [session])
  useEffect(() => { sessionRef.current = session }, [session])
  useEffect(() => { membersRef.current = members }, [members])
  useEffect(() => {
    const prime = () => primeAudio()
    window.addEventListener('pointerdown', prime, { once: true })
    return () => window.removeEventListener('pointerdown', prime)
  }, [])

  function show(gate, res) {
    setGates((g) => ({ ...g, [gate]: { ...res, at: Date.now() } }))
  }

  function onTap(uid, reader) {
    if (!reader || reader === 'desk') {
      if (uid) setDeskUid(uid)
      return
    }
    const key = `${reader}:${uid}`
    const now = Date.now()
    if (recent.current.get(key) && now - recent.current.get(key) < 3500) return
    recent.current.set(key, now)
    handleGate(uid, reader)
  }
  useLocalReader(onTap)

  async function handleGate(uid, gate) {
    const sess = sessionRef.current
    const fee = sess?.feePerPerson ?? 0
    const local = membersRef.current.find((m) => m.memberToken === uid || m.cardUid === uid)

    // Instant verdict from the local member cache -> reader LED + on-screen.
    if (local) {
      const ok = !(fee && (local.balance || 0) < fee)
      sendReaderFeedback(gate, ok)
      feedback(ok)
      show(gate, ok
        ? { kind: 'welcome', name: local.name, photoURL: local.photoURL, pending: true }
        : { kind: 'low', name: local.name, photoURL: local.photoURL })
    }

    // Confirm in the cloud, then log the definitive event for the tablets.
    try {
      const res = await checkInMember(uid, gate, sess)
      let evt
      if (res.ok) {
        evt = { ok: true, kind: res.reason === 'reentry' ? 'reentry' : 'welcome', name: res.member?.name || '', photoURL: res.member?.photoURL || '' }
      } else if (res.reason === 'already') {
        evt = { ok: true, kind: 'already', name: res.member?.name || '', photoURL: res.member?.photoURL || '' }
      } else if (res.reason === 'insufficient') {
        evt = { ok: false, kind: 'low', name: res.member?.name || '', photoURL: res.member?.photoURL || '' }
      } else if (res.reason === 'nosession') {
        evt = { ok: false, kind: 'nosession', name: '', photoURL: '' }
      } else {
        evt = { ok: false, kind: 'notreg', name: '', photoURL: '' }
      }
      logScanEvent({ gate, ...evt })
      if (!local) {
        sendReaderFeedback(gate, evt.ok)
        feedback(evt.ok)
      }
      show(gate, { kind: evt.kind, name: evt.name, photoURL: evt.photoURL })
    } catch {
      if (!local) { sendReaderFeedback(gate, false); feedback(false) }
      show(gate, { kind: 'error' })
    }
  }

  const checkedIn = useMemo(() => bookings.filter((b) => b.status === 'checked_in'), [bookings])
  const insideNow = checkedIn.filter((b) => !b.exitedAt).reduce((n, b) => n + (b.peopleCount || 0), 0)
  const attendees = checkedIn.reduce((n, b) => n + (b.peopleCount || 0), 0)

  return (
    <div className="page wide station">
      <header className="topbar">
        <div>
          <div className="brand"><span className="leaf">🌿</span>Station Hub</div>
          <div className="muted small">{session ? 'Session live — readers armed' : '⏳ No active session'}</div>
        </div>
        <div className="row gap">
          <span className="live-pill"><span className="live-dot" />{insideNow} inside · {attendees} today</span>
          <Link className="btn ghost small" to="/admin/credits" target="_blank">Reception</Link>
          <Link className="btn ghost small" to="/admin" target="_blank">Command Center</Link>
        </div>
      </header>

      <div className="st-grid">
        <GatePanel title="🚪 Door 1" r={gates.gate1} />
        <GatePanel title="🚪 Door 2" r={gates.gate2} />
      </div>

      <div className="card st-desk">
        <div className="row between">
          <h3 style={{ margin: 0 }}>🖥️ Desk reader</h3>
          <span className="muted small">{deskUid ? `Last card: ${deskUid}` : 'No card tapped yet'}</span>
        </div>
        <p className="muted small" style={{ margin: '8px 0 0' }}>
          Desk taps are used by <b>Reception → Tap card to find member</b> and <b>Assign card</b>. Keep this page open; open Reception in another tab.
        </p>
      </div>

      <p className="muted small center-text">
        Bridge: run <b>card-bridge\start_pcsc.bat</b> on this PC · readers light <span className="pos">green ✓</span> to enter, <span className="neg">red ✗</span> = go to desk
      </p>
    </div>
  )
}

function GatePanel({ title, r }) {
  const kindCfg = {
    welcome: { cls: 'ok', line: '✓ Checked in — welcome!' },
    reentry: { cls: 'ok', line: '✓ Welcome back' },
    already: { cls: 'ok', line: '↺ Already inside' },
    low: { cls: 'err', line: 'Low balance — send to desk' },
    notreg: { cls: 'err', line: 'Unknown card — send to desk' },
    nosession: { cls: 'err', line: 'No active session' },
    error: { cls: 'err', line: 'Network hiccup — retap' },
  }
  const cfg = r ? kindCfg[r.kind] : null
  return (
    <div className={`st-panel ${cfg ? cfg.cls : ''}`}>
      <div className="st-title">{title}</div>
      {!r && <div className="st-idle">Waiting for a tap…</div>}
      {r && (
        <div className="st-result">
          {r.photoURL
            ? <img className="st-face" src={r.photoURL} alt="" />
            : <span className="st-face fb">{(r.name || '?')[0]}</span>}
          <div>
            <div className="st-name">{r.name || 'Unknown card'}</div>
            <div className="st-line">{cfg.line}{r.pending ? '…' : ''}</div>
          </div>
        </div>
      )}
    </div>
  )
}
