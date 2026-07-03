import { useEffect, useRef, useState } from 'react'
import { subscribeActiveSession, checkInMember } from '../lib/db'
import { useCardWedge } from '../lib/wedge'
import { feedback, vibrate, primeAudio } from '../lib/feedback'
import { confetti } from '../lib/celebrate'

// Clean full-screen card-only scanner. Tap a card -> Welcome + name + photo,
// or "Card not registered". No camera, no QR, no manual — just the tap.
export default function CardScan() {
  const [session, setSession] = useState(null)
  const [result, setResult] = useState(null)
  const sessionRef = useRef(null)
  const lockRef = useRef(false)
  const timer = useRef(null)

  useEffect(() => subscribeActiveSession(setSession), [])
  useEffect(() => { sessionRef.current = session }, [session])
  useEffect(() => {
    const prime = () => primeAudio()
    window.addEventListener('pointerdown', prime, { once: true })
    return () => window.removeEventListener('pointerdown', prime)
  }, [])

  function show(res) {
    setResult(res)
    if (res.kind === 'welcome') {
      feedback(true)
      confetti(28)
    } else if (res.kind === 'already') {
      vibrate(true)
    } else {
      feedback(false)
    }
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      lockRef.current = false
      setResult(null)
    }, 2800)
  }

  useCardWedge((code) => {
    if (lockRef.current) return
    lockRef.current = true
    handle(code.trim())
  }, true)

  async function handle(code) {
    try {
      const res = await checkInMember(code, 'card', sessionRef.current)
      if (res.reason === 'unknown') show({ kind: 'notreg' })
      else if (res.ok) show({ kind: 'welcome', member: res.member, sessionsLeft: res.sessionsLeft })
      else if (res.reason === 'already') show({ kind: 'already', member: res.member, sessionsLeft: res.sessionsLeft })
      else if (res.reason === 'insufficient') show({ kind: 'low', member: res.member })
      else if (res.reason === 'nosession') show({ kind: 'nosession' })
      else show({ kind: 'notreg' })
    } catch (e) {
      show({ kind: 'notreg', message: e.message })
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
          {r.kind === 'already' ? '↺ Already inside' : `✓ Checked in · ${r.sessionsLeft} sessions left`}
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
