import { useEffect, useRef, useState } from 'react'
import { subscribeActiveSession, subscribeMembers, checkInMember } from '../lib/db'
import { useCardWedge } from '../lib/wedge'
import { useLocalReader } from '../lib/localReader'
import { useWakeLock } from '../lib/wakeLock'
import { feedback, vibrate, primeAudio } from '../lib/feedback'
import { confetti } from '../lib/celebrate'

// Clean full-screen card-only scanner. Tap a card -> instant Welcome + name +
// photo (resolved from a local member cache so it feels immediate), while the
// real check-in / deduction confirms in the background.
export default function CardScan() {
  const [session, setSession] = useState(null)
  const [members, setMembers] = useState([])
  const [result, setResult] = useState(null)
  const sessionRef = useRef(null)
  const membersRef = useRef([])
  const lockRef = useRef(false)
  const timer = useRef(null)

  useWakeLock(true) // keep the wall tablet's screen on
  useEffect(() => subscribeActiveSession(setSession), [])
  useEffect(() => subscribeMembers(setMembers), [])
  useEffect(() => { sessionRef.current = session }, [session])
  useEffect(() => { membersRef.current = members }, [members])
  useEffect(() => {
    const prime = () => primeAudio()
    window.addEventListener('pointerdown', prime, { once: true })
    return () => window.removeEventListener('pointerdown', prime)
  }, [])

  function resetTimer() {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      lockRef.current = false
      setResult(null)
    }, 2800)
  }

  function render(res, playFeedback) {
    setResult(res)
    if (playFeedback) {
      if (res.kind === 'welcome') { feedback(true); confetti(28) }
      else if (res.kind === 'already') vibrate(true)
      else feedback(false)
    }
    resetTimer()
  }

  function onCard(code) {
    if (lockRef.current) return
    lockRef.current = true
    handle(code.trim())
  }
  useLocalReader(onCard) // USB reader via the local bridge (no focus needed)
  useCardWedge(onCard, true) // keyboard-mode reader fallback

  async function handle(code) {
    const fee = sessionRef.current?.feePerPerson ?? 0
    const local = membersRef.current.find((m) => m.memberToken === code || m.cardUid === code)

    // Instant feedback from the local cache — no network wait.
    let shownWelcome = false
    if (local) {
      if (fee && (local.balance || 0) < fee) {
        render({ kind: 'low', member: local }, true)
      } else {
        render({ kind: 'welcome', member: local, pending: true }, true)
        shownWelcome = true
      }
    }

    // Real check-in (deduct + dedup) confirms / corrects in the background.
    try {
      const res = await checkInMember(code, 'card', sessionRef.current)
      if (res.reason === 'unknown') render({ kind: 'notreg' }, !local)
      else if (res.ok) render({ kind: 'welcome', member: res.member, sessionsLeft: res.sessionsLeft }, !shownWelcome)
      else if (res.reason === 'already') render({ kind: 'already', member: res.member, sessionsLeft: res.sessionsLeft }, true)
      else if (res.reason === 'insufficient') render({ kind: 'low', member: res.member }, !local)
      else if (res.reason === 'nosession') render({ kind: 'nosession' }, true)
      else render({ kind: 'notreg' }, true)
    } catch (e) {
      if (!local) render({ kind: 'notreg', message: e.message }, true)
    }
  }

  return (
    <div className="cardscan">
      {!result && (
        <div className="cardscan-idle">
          <div className="cardscan-badge">💳</div>
          <div className="cardscan-title">Tap your card</div>
          <div className="cardscan-sub">
            {session ? 'Welcome to Saturday Training' : '⏳ Waiting for the session to start'}
          </div>
        </div>
      )}
      {result && <ResultView r={result} />}
    </div>
  )
}

function ResultView({ r }) {
  const m = r.member
  const photo = m?.photoURL
  const initial = (m?.name || '?')[0]

  if (r.kind === 'welcome' || r.kind === 'already') {
    return (
      <div className={`cardscan-result ${r.kind === 'welcome' ? 'ok' : 'already'}`}>
        {photo ? <img className="cardscan-photo" src={photo} alt="" /> : <div className="cardscan-photo fallback">{initial}</div>}
        <div className="cardscan-name">{r.kind === 'welcome' ? `Welcome, ${m?.name}! 👋` : m?.name}</div>
        <div className="cardscan-line">
          {r.kind === 'already'
            ? '↺ Already inside'
            : r.pending
              ? 'Checking you in…'
              : `✓ Checked in · ${r.sessionsLeft} sessions left`}
        </div>
      </div>
    )
  }
  if (r.kind === 'low') {
    return (
      <div className="cardscan-result warn">
        {photo ? <img className="cardscan-photo" src={photo} alt="" /> : <div className="cardscan-photo fallback">{initial}</div>}
        <div className="cardscan-name">{m?.name}</div>
        <div className="cardscan-line">Low balance — please top up at the desk</div>
      </div>
    )
  }
  if (r.kind === 'nosession') {
    return (
      <div className="cardscan-result neutral">
        <div className="cardscan-bigicon">⏳</div>
        <div className="cardscan-name">No active session</div>
        <div className="cardscan-line">Ask the admin to start one</div>
      </div>
    )
  }
  return (
    <div className="cardscan-result err">
      <div className="cardscan-bigicon">✕</div>
      <div className="cardscan-name">Card not registered</div>
      <div className="cardscan-line">Assign this card to a member in Admin → Credits</div>
    </div>
  )
}
