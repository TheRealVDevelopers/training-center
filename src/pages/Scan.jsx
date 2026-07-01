import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Html5Qrcode } from 'html5-qrcode'
import { CURRENCY } from '../config'
import {
  checkInByToken,
  subscribeMembers,
  subscribeActiveSession,
  findMemberPendingBookings,
} from '../lib/db'
import { feedback, vibrate, primeAudio } from '../lib/feedback'
import { enqueue, getQueue, removeFromQueue, queueSize } from '../lib/scanQueue'
import { confetti } from '../lib/celebrate'

// Scanner-only page. Scan a QR (or "Find by name") to admit. Gives an audible
// beep + vibrate on every result so volunteers needn't watch the screen, and
// queues scans locally if the connection drops — replaying when it returns.
export default function Scan() {
  const [params] = useSearchParams()
  const gate = params.get('gate') || '1'

  const [result, setResult] = useState(null)
  const [camErr, setCamErr] = useState('')
  const [online, setOnline] = useState(navigator.onLine)
  const [queued, setQueued] = useState(queueSize())

  const [manual, setManual] = useState(false)
  const [members, setMembers] = useState([])
  const [session, setSession] = useState(null)
  const [search, setSearch] = useState('')
  const [picked, setPicked] = useState(null)
  const [pending, setPending] = useState(null)
  const [lookupBusy, setLookupBusy] = useState(false)

  const lockRef = useRef(false)
  const clearTimer = useRef(null)

  useEffect(() => subscribeMembers(setMembers), [])
  useEffect(() => subscribeActiveSession(setSession), [])

  function showResult(res) {
    setResult(res)
    if (res?.reason === 'queued') vibrate(true)
    else if (res && typeof res.ok === 'boolean') {
      feedback(res.ok)
      if (res.ok) confetti(24)
    }
    if (clearTimer.current) clearTimeout(clearTimer.current)
    clearTimer.current = setTimeout(() => {
      lockRef.current = false
      setResult(null)
    }, 2200)
  }

  async function processCheckIn(token) {
    if (!navigator.onLine) {
      enqueue(token, gate)
      setQueued(queueSize())
      showResult({ ok: false, reason: 'queued', message: 'Offline — saved, syncs when back online' })
      return
    }
    try {
      const res = await checkInByToken(token, gate)
      showResult(res)
    } catch {
      enqueue(token, gate)
      setQueued(queueSize())
      showResult({ ok: false, reason: 'queued', message: 'Connection issue — saved, will sync' })
    }
  }

  async function flushQueue() {
    for (const item of getQueue()) {
      try {
        await checkInByToken(item.token, item.gate)
        removeFromQueue(item.token) // reached server (any verdict) → done
      } catch {
        break // still offline; retry on next reconnect
      }
    }
    setQueued(queueSize())
  }

  // Camera — defensive so a missing/denied camera degrades to "Find by name".
  useEffect(() => {
    let scanner
    let mounted = true
    async function onScan(decodedText) {
      if (lockRef.current) return
      lockRef.current = true
      await processCheckIn(decodedText.trim())
    }
    try {
      scanner = new Html5Qrcode('reader', { verbose: false })
      Promise.resolve()
        .then(() => scanner.start({ facingMode: 'environment' }, { fps: 12, qrbox: 260 }, onScan, () => {}))
        .catch((e) => mounted && setCamErr(e?.message || String(e)))
    } catch (e) {
      setCamErr(e?.message || 'Camera not available')
    }
    return () => {
      mounted = false
      if (clearTimer.current) clearTimeout(clearTimer.current)
      try {
        scanner?.stop().then(() => scanner.clear()).catch(() => {})
      } catch {
        /* never started */
      }
    }
  }, [gate])

  // Connectivity + audio priming + flush any leftover queue.
  useEffect(() => {
    const onOnline = () => { setOnline(true); flushQueue() }
    const onOffline = () => setOnline(false)
    const prime = () => primeAudio()
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    window.addEventListener('pointerdown', prime, { once: true })
    flushQueue()
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
      window.removeEventListener('pointerdown', prime)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function pickMember(m) {
    setPicked(m)
    setPending(null)
    setLookupBusy(true)
    try {
      setPending(await findMemberPendingBookings(m.id, session?.id))
    } finally {
      setLookupBusy(false)
    }
  }

  async function manualCheckIn(booking) {
    lockRef.current = true
    closeManual()
    await processCheckIn(booking.id)
  }

  function closeManual() {
    setManual(false)
    setPicked(null)
    setPending(null)
    setSearch('')
  }

  const q = search.trim().toLowerCase()
  const matches = q
    ? members
        .filter((m) => (m.name || '').toLowerCase().includes(q) || (m.mobile || '').includes(q))
        .slice(0, 8)
    : []

  const resultClass = result?.ok ? 'ok' : result?.reason === 'queued' ? 'queued' : 'err'
  const resultIcon = result?.ok ? '✓' : result?.reason === 'queued' ? '⏳' : '✕'

  return (
    <div className="scanpage">
      <div className="scan-gate">Gate {gate}</div>
      <div className={`scan-status ${online ? 'on' : 'off'}`}>
        {online ? '● Online' : '⚠ Offline'}{queued > 0 ? ` · ${queued} queued` : ''}
      </div>
      <div id="reader" className="reader" />

      {!manual && !result && !camErr && (
        <div className="scan-frame"><i /><div className="scan-line" /></div>
      )}

      {!manual && !result && (
        <button className="scan-manual-btn" onClick={() => setManual(true)}>
          ⌨️ Forgot QR? Find by name
        </button>
      )}

      {camErr && !manual && !result && (
        <div className="scan-result err">
          <div className="scan-msg">Camera unavailable</div>
          <div className="muted small" style={{ color: 'rgba(255,255,255,0.8)' }}>{camErr}</div>
          <div className="muted small" style={{ color: 'rgba(255,255,255,0.8)' }}>
            Allow camera access (needs HTTPS or localhost), or use “Find by name”.
          </div>
        </div>
      )}

      {result && (
        <div className={`scan-result ${resultClass}`}>
          <div className="scan-icon">{resultIcon}</div>
          {result.booking && (
            <>
              <div className="scan-name">{result.booking.memberName}</div>
              <div className="scan-count">
                {result.booking.peopleCount} {result.booking.peopleCount > 1 ? 'people' : 'person'}
              </div>
              {result.booking.people && (
                <div className="scan-faces">
                  {result.booking.people.map((p, i) =>
                    p.photoURL ? (
                      <img key={i} src={p.photoURL} alt="" />
                    ) : (
                      <div key={i} className="avatar-fallback sm">{(p.name || '?')[0]}</div>
                    ),
                  )}
                </div>
              )}
            </>
          )}
          <div className="scan-msg">{result.message}</div>
        </div>
      )}

      {manual && (
        <div className="manual-panel">
          <div className="manual-head">
            <span className="strong">Find member</span>
            <button className="btn ghost small" onClick={closeManual}>Close</button>
          </div>

          {!picked ? (
            <>
              <input
                autoFocus
                placeholder="Name or mobile…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <div className="manual-list">
                {matches.map((m) => (
                  <button key={m.id} className="manual-row" onClick={() => pickMember(m)}>
                    {m.photoURL ? (
                      <img src={m.photoURL} alt="" />
                    ) : (
                      <span className="avatar-fallback sm">{(m.name || '?')[0]}</span>
                    )}
                    <span className="manual-name">
                      {m.name}<span className="muted small"> · {m.mobile}</span>
                    </span>
                  </button>
                ))}
                {q && matches.length === 0 && <div className="muted small">No member matches “{search}”.</div>}
              </div>
            </>
          ) : (
            <div>
              <div className="manual-head">
                <span className="strong">{picked.name}</span>
                <button className="btn ghost small" onClick={() => { setPicked(null); setPending(null) }}>‹ Back</button>
              </div>
              {lookupBusy && <div className="muted small">Looking up bookings…</div>}
              {pending && pending.length === 0 && (
                <div className="manual-empty">No active booking for this member in the current session.</div>
              )}
              {pending &&
                pending.map((b) => (
                  <button key={b.id} className="manual-booking" onClick={() => manualCheckIn(b)}>
                    Admit · {b.peopleCount} {b.peopleCount > 1 ? 'people' : 'person'} · {CURRENCY}{b.totalAmount}
                  </button>
                ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
