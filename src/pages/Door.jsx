import { useEffect, useMemo, useRef, useState } from 'react'
import {
  subscribeActiveSession,
  subscribeSessionBookings,
  subscribeMembers,
  checkInMember,
  checkOutMember,
} from '../lib/db'
import { useCardWedge } from '../lib/wedge'
import { useLocalReader } from '../lib/localReader'
import { useWakeLock } from '../lib/wakeLock'
import { feedback, vibrate, primeAudio } from '../lib/feedback'
import { confetti } from '../lib/celebrate'

// Wall-tablet door screen. A keyboard-mode NFC reader (or the USB bridge) taps
// a card -> big Welcome/Goodbye flash + name/photo, and a live running list of
// everyone entering/leaving. Entry mode checks people in (charges once); Exit
// mode taps them out (no charge). Same reader does both — staff pick the mode.
export default function Door() {
  const gate = new URLSearchParams(window.location.search).get('gate') || ''
  const [session, setSession] = useState(null)
  const [bookings, setBookings] = useState([])
  const [members, setMembers] = useState([])
  const [mode, setMode] = useState('entry') // 'entry' | 'exit'
  const [flash, setFlash] = useState(null)

  const sessionRef = useRef(null)
  const membersRef = useRef([])
  const modeRef = useRef('entry')
  const recent = useRef(new Map()) // code -> last-handled ms (per-card dedup)
  const timer = useRef(null)

  useWakeLock(true) // keep the wall tablet's screen on
  useEffect(() => subscribeActiveSession(setSession), [])
  useEffect(() => subscribeMembers(setMembers), [])
  useEffect(() => (session ? subscribeSessionBookings(session.id, setBookings) : undefined), [session])
  useEffect(() => { sessionRef.current = session }, [session])
  useEffect(() => { membersRef.current = members }, [members])
  useEffect(() => { modeRef.current = mode }, [mode])
  useEffect(() => {
    const prime = () => primeAudio()
    window.addEventListener('pointerdown', prime, { once: true })
    return () => window.removeEventListener('pointerdown', prime)
  }, [])

  function show(res, good) {
    setFlash(res)
    if (good === true) { feedback(true); if (res.kind === 'welcome') confetti(24) }
    else if (good === false) feedback(false)
    else vibrate(true)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setFlash(null), 2600)
  }

  function onCard(code) {
    if (!code) return
    const now = Date.now()
    const last = recent.current.get(code)
    // Same card within 3.5s = a double-read or an accidental re-tap — ignore.
    // A different card is handled immediately, so a queue never gets blocked.
    if (last && now - last < 3500) return
    recent.current.set(code, now)
    handle(code)
  }
  useLocalReader(onCard) // USB reader via the local bridge
  useCardWedge(onCard, true) // keyboard-mode NFC/QR reader

  async function handle(code) {
    const sess = sessionRef.current
    const local = membersRef.current.find((m) => m.memberToken === code || m.cardUid === code)

    if (modeRef.current === 'exit') {
      // Optimistic goodbye, then confirm.
      if (local) show({ kind: 'left', member: local }, null)
      const res = await checkOutMember(code, sess)
      if (res.reason === 'unknown') show({ kind: 'notreg' }, false)
      else if (res.ok) show({ kind: 'left', member: res.member }, null)
      else if (res.reason === 'notin') show({ kind: 'notin', member: res.member }, false)
      else if (res.reason === 'alreadyout') show({ kind: 'left', member: res.member }, null)
      else if (res.reason === 'nosession') show({ kind: 'nosession' }, false)
      return
    }

    // Entry mode — instant welcome from the local cache, confirm in background.
    const fee = sess?.feePerPerson ?? 0
    let shown = false
    if (local) {
      if (fee && (local.balance || 0) < fee) show({ kind: 'low', member: local }, false)
      else { show({ kind: 'welcome', member: local, pending: true }, true); shown = true }
    }
    const res = await checkInMember(code, gate ? `door-${gate}` : 'door', sess)
    if (res.reason === 'unknown') show({ kind: 'notreg' }, shown ? undefined : false)
    else if (res.ok) show({ kind: 'welcome', member: res.member, sessionsLeft: res.sessionsLeft, reentry: res.reason === 'reentry' }, shown ? undefined : true)
    else if (res.reason === 'already') show({ kind: 'already', member: res.member }, null)
    else if (res.reason === 'insufficient') show({ kind: 'low', member: res.member }, shown ? undefined : false)
    else if (res.reason === 'nosession') show({ kind: 'nosession' }, false)
  }

  // Live list: everyone with an entry this session, newest activity first.
  const feed = useMemo(() => {
    return bookings
      .filter((b) => b.status === 'checked_in')
      .map((b) => ({
        id: b.id,
        name: b.memberName,
        photo: b.people?.[0]?.photoURL || '',
        inside: !b.exitedAt,
        at: b.exitedAt?.seconds || b.checkedInAt?.seconds || 0,
      }))
      .sort((a, b) => b.at - a.at)
  }, [bookings])
  const insideNow = feed.filter((f) => f.inside).length

  return (
    <div className="door">
      <div className="door-top">
        <div className="door-brand">
          <span className="leaf">🌿</span>
          <div>
            <div className="door-title">Saturday Training</div>
            <div className="door-sub">{gate ? `Door ${gate}` : 'Door'} · <b>{insideNow}</b> inside</div>
          </div>
        </div>
        <div className="door-modes">
          <button className={mode === 'entry' ? 'on in' : ''} onClick={() => setMode('entry')}>↓ Entry</button>
          <button className={mode === 'exit' ? 'on out' : ''} onClick={() => setMode('exit')}>↑ Exit</button>
        </div>
      </div>

      <div className="door-body">
        <div className={`door-stage ${mode}`}>
          {flash ? <Flash r={flash} /> : (
            <div className="door-idle">
              <div className="door-idle-icon">{mode === 'exit' ? '👋' : '💳'}</div>
              <div className="door-idle-title">{mode === 'exit' ? 'Tap to leave' : 'Tap your card'}</div>
              <div className="door-idle-sub">
                {session ? (mode === 'exit' ? 'Thanks for coming!' : 'Welcome — tap to enter') : '⏳ Waiting for the session to start'}
              </div>
            </div>
          )}
        </div>

        <aside className="door-list">
          <div className="door-list-head">Live · {insideNow} inside</div>
          {feed.length === 0 && <div className="door-list-empty">No entries yet</div>}
          {feed.slice(0, 40).map((f) => (
            <div className={`door-item ${f.inside ? '' : 'gone'}`} key={f.id}>
              {f.photo ? <img src={f.photo} alt="" /> : <span className="door-item-fb">{(f.name || '?')[0]}</span>}
              <span className="door-item-name">{f.name}</span>
              <span className={`door-item-tag ${f.inside ? 'in' : 'out'}`}>{f.inside ? 'in' : 'left'}</span>
            </div>
          ))}
        </aside>
      </div>
    </div>
  )
}

function Flash({ r }) {
  const m = r.member
  const photo = m?.photoURL
  const initial = (m?.name || '?')[0]
  const avatar = photo ? <img className="door-face" src={photo} alt="" /> : <div className="door-face fb">{initial}</div>

  if (r.kind === 'welcome') {
    return (
      <div className="door-flash ok">
        {avatar}
        <div className="door-flash-name">{r.reentry ? `Welcome back, ${m?.name}!` : `Welcome, ${m?.name}!`} 👋</div>
        <div className="door-flash-line">{r.pending ? 'Checking you in…' : r.reentry ? 'Back inside' : `✓ Checked in${r.sessionsLeft != null ? ` · ${r.sessionsLeft} left` : ''}`}</div>
      </div>
    )
  }
  if (r.kind === 'already') {
    return <div className="door-flash already">{avatar}<div className="door-flash-name">{m?.name}</div><div className="door-flash-line">↺ Already inside</div></div>
  }
  if (r.kind === 'left') {
    return <div className="door-flash bye">{avatar}<div className="door-flash-name">Bye, {m?.name}! 👋</div><div className="door-flash-line">✓ Checked out</div></div>
  }
  if (r.kind === 'notin') {
    return <div className="door-flash warn">{avatar}<div className="door-flash-name">{m?.name}</div><div className="door-flash-line">Not checked in yet</div></div>
  }
  if (r.kind === 'low') {
    return <div className="door-flash warn">{avatar}<div className="door-flash-name">{m?.name}</div><div className="door-flash-line">Low balance — top up at the desk</div></div>
  }
  if (r.kind === 'nosession') {
    return <div className="door-flash neutral"><div className="door-flash-icon">⏳</div><div className="door-flash-name">No active session</div><div className="door-flash-line">Ask the admin to start one</div></div>
  }
  return <div className="door-flash err"><div className="door-flash-icon">✕</div><div className="door-flash-name">Card not registered</div><div className="door-flash-line">Assign it in Admin → Credits</div></div>
}
