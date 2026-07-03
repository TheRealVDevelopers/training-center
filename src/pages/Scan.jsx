import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Html5Qrcode } from 'html5-qrcode'
import { CURRENCY } from '../config'
import {
  checkInMember,
  checkInByToken,
  subscribeMembers,
  subscribeActiveSession,
  ensureMemberToken,
} from '../lib/db'
import { feedback, vibrate, primeAudio } from '../lib/feedback'
import { enqueue, getQueue, removeFromQueue, queueSize } from '../lib/scanQueue'
import { confetti } from '../lib/celebrate'
import { nfcSupported, startNfcRead } from '../lib/nfc'
import { useCardWedge } from '../lib/wedge'
import { useLocalReader } from '../lib/localReader'

// Door check-in. Three inputs, one flow: NFC card tap, QR camera scan, or
// find-by-name. Each resolves to a member token → walk-in check-in (deduct one
// session, mark inside). Falls back to legacy booking tokens for old QRs.
export default function Scan() {
  const [params] = useSearchParams()
  const gate = params.get('gate') || '1'

  const [result, setResult] = useState(null)
  const [camErr, setCamErr] = useState('')
  const [online, setOnline] = useState(navigator.onLine)
  const [queued, setQueued] = useState(queueSize())
  const [nfcOn, setNfcOn] = useState(false)
  const [nfcErr, setNfcErr] = useState('')

  const [manual, setManual] = useState(false)
  const [members, setMembers] = useState([])
  const [session, setSession] = useState(null)
  const [search, setSearch] = useState('')

  const lockRef = useRef(false)
  const clearTimer = useRef(null)
  const sessionRef = useRef(null)
  const nfcStopRef = useRef(null)

  useEffect(() => subscribeMembers(setMembers), [])
  useEffect(() => subscribeActiveSession(setSession), [])
  useEffect(() => { sessionRef.current = session }, [session])

  // USB card reader: local bridge (no focus needed) + keyboard-mode fallback.
  function onCardCode(code) {
    if (lockRef.current) return
    lockRef.current = true
    processCheckIn(code.trim())
  }
  useLocalReader(onCardCode)
  useCardWedge(onCardCode, !manual)

  // Unified check-in: walk-in member token first, legacy booking token fallback.
  async function doCheckIn(token) {
    let res = await checkInMember(token, gate, sessionRef.current)
    if (!res.ok && res.reason === 'unknown') {
      res = await checkInByToken(token, gate)
    }
    return res
  }

  function showResult(res) {
    setResult(res)
    if (res?.reason === 'queued' || res?.reason === 'already') vibrate(true)
    else if (res && typeof res.ok === 'boolean') {
      feedback(res.ok)
      if (res.ok) confetti(24)
    }
    if (clearTimer.current) clearTimeout(clearTimer.current)
    clearTimer.current = setTimeout(() => {
      lockRef.current = false
      setResult(null)
    }, 2400)
  }

  async function processCheckIn(token) {
    if (!navigator.onLine) {
      enqueue(token, gate)
      setQueued(queueSize())
      showResult({ ok: false, reason: 'queued', message: 'Offline — saved, syncs when back online' })
      return
    }
    try {
      showResult(await doCheckIn(token))
    } catch {
      enqueue(token, gate)
      setQueued(queueSize())
      showResult({ ok: false, reason: 'queued', message: 'Connection issue — saved, will sync' })
    }
  }

  async function flushQueue() {
    for (const item of getQueue()) {
      try {
        await doCheckIn(item.token)
        removeFromQueue(item.token)
      } catch {
        break
      }
    }
    setQueued(queueSize())
  }

  // Camera QR
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
      try { scanner?.stop().then(() => scanner.clear()).catch(() => {}) } catch { /* never started */ }
    }
  }, [gate])

  // Connectivity + audio prime + flush leftover queue
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
      if (nfcStopRef.current) nfcStopRef.current()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function enableNfc() {
    setNfcErr('')
    try {
      const stop = await startNfcRead(
        (token) => {
          if (lockRef.current) return
          lockRef.current = true
          processCheckIn(token)
        },
        (msg) => setNfcErr(msg),
      )
      nfcStopRef.current = stop
      setNfcOn(true)
    } catch (e) {
      setNfcErr(e.message)
    }
  }

  async function manualCheckIn(m) {
    lockRef.current = true
    closeManual()
    let token = m.memberToken
    if (!token) {
      try { token = await ensureMemberToken(m) } catch { /* ignore */ }
    }
    if (!token) {
      showResult({ ok: false, message: 'No card token for this member' })
      return
    }
    await processCheckIn(token)
  }

  function closeManual() {
    setManual(false)
    setSearch('')
  }

  const q = search.trim().toLowerCase()
  const matches = q
    ? members.filter((m) => (m.name || '').toLowerCase().includes(q) || (m.mobile || '').includes(q)).slice(0, 8)
    : []

  const cls = result?.ok ? 'ok' : result?.reason === 'queued' ? 'queued' : result?.reason === 'already' ? 'already' : 'err'
  const icon = result?.ok ? '✓' : result?.reason === 'queued' ? '⏳' : result?.reason === 'already' ? '↺' : '✕'
  const rName = result?.member?.name || result?.booking?.memberName || ''
  const rPhotos = result?.member
    ? [{ name: result.member.name, photoURL: result.member.photoURL }]
    : result?.booking?.people || []
  const rSub = result?.ok
    ? (result.sessionsLeft != null ? `${result.sessionsLeft} sessions left` : '')
    : result?.reason === 'already'
      ? `${result.sessionsLeft ?? ''} sessions left`
      : ''

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

      {/* Bottom controls: NFC + manual lookup */}
      {!manual && !result && (
        <div className="scan-controls">
          <div className="scan-hint">💳 Tap a card on the reader · or scan a QR</div>
          <div className="row gap" style={{ justifyContent: 'center' }}>
            {nfcSupported() && (
              <button className={`scan-pill ${nfcOn ? 'live' : ''}`} onClick={enableNfc} disabled={nfcOn}>
                {nfcOn ? '📶 Tap a card…' : '📶 Phone NFC'}
              </button>
            )}
            <button className="scan-pill" onClick={() => setManual(true)}>⌨️ Find by name</button>
          </div>
        </div>
      )}
      {nfcErr && !result && <div className="scan-nfcerr">{nfcErr}</div>}

      {camErr && !manual && !result && (
        <div className="scan-result err">
          <div className="scan-msg">Camera unavailable</div>
          <div className="muted small" style={{ color: 'rgba(255,255,255,0.8)' }}>{camErr}</div>
          <div className="muted small" style={{ color: 'rgba(255,255,255,0.8)' }}>
            {nfcSupported() ? 'Use “Enable card tap” or “Find by name”.' : 'Use “Find by name”.'}
          </div>
        </div>
      )}

      {result && (
        <div className={`scan-result ${cls}`}>
          <div className="scan-icon">{icon}</div>
          {rName && <div className="scan-name">{rName}</div>}
          {rSub && <div className="scan-count">{rSub}</div>}
          {rPhotos.length > 0 && (
            <div className="scan-faces">
              {rPhotos.map((p, i) =>
                p.photoURL ? <img key={i} src={p.photoURL} alt="" /> : <div key={i} className="avatar-fallback sm">{(p.name || '?')[0]}</div>,
              )}
            </div>
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
          <input autoFocus placeholder="Name or mobile…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <div className="manual-list">
            {matches.map((m) => (
              <button key={m.id} className="manual-row" onClick={() => manualCheckIn(m)}>
                {m.photoURL ? <img src={m.photoURL} alt="" /> : <span className="avatar-fallback sm">{(m.name || '?')[0]}</span>}
                <span className="manual-name">{m.name}<span className="muted small"> · {m.mobile}</span></span>
                <span className="tag ok">Let in ›</span>
              </button>
            ))}
            {q && matches.length === 0 && <div className="muted small">No member matches “{search}”.</div>}
          </div>
        </div>
      )}
    </div>
  )
}
