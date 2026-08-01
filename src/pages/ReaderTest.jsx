import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { QRCodeCanvas } from 'qrcode.react'
import { subscribeMembers } from '../lib/db'
import { useLocalReader } from '../lib/localReader'
import { normalizeCode } from '../lib/readerId'
import { feedback } from '../lib/feedback'

// Hardware test bench. Tap cards, scan QRs — every read the app receives is
// echoed here with its raw bytes, source and member match. NOTHING is written:
// no entries, no charges, no sessions. If it works here, Reception will work.
export default function ReaderTest() {
  const [members, setMembers] = useState([])
  const [bridgeUp, setBridgeUp] = useState(null)
  const [focused, setFocused] = useState(true)
  const [log, setLog] = useState([])

  const membersRef = useRef([])
  useEffect(() => subscribeMembers(setMembers), [])
  useEffect(() => { membersRef.current = members }, [members])

  // Window focus — a keyboard-mode reader can only reach a focused window.
  useEffect(() => {
    const check = () => setFocused(document.hasFocus())
    check()
    const id = setInterval(check, 600)
    window.addEventListener('focus', check)
    window.addEventListener('blur', check)
    return () => { clearInterval(id); window.removeEventListener('focus', check); window.removeEventListener('blur', check) }
  }, [])

  function addRead({ source, raw, endedBy, ms }) {
    const code = normalizeCode(raw)
    const match = membersRef.current.find(
      (m) => m.memberToken === code || m.cardUid === code || (m.cardUids || []).includes(code),
    ) || null
    feedback(true) // the app's own ding = "the page received it" (≠ the gun's beep)
    setLog((l) => [{
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      time: new Date(),
      source, raw, code, endedBy, ms,
      match: match ? { name: match.name, credits: match.credits || 0, couple: !!match.couple } : null,
    }, ...l].slice(0, 30))
  }

  // USB bridge (NFC card readers) — polls the local bridge program.
  useLocalReader((uid, reader) => addRead({ source: `USB · ${reader || 'reader'}`, raw: uid, endedBy: 'bridge', ms: 0 }), setBridgeUp)

  // Keyboard capture (QR gun / keyboard-mode NFC) — the SAME hidden-catcher
  // approach Reception uses, so this page tests exactly what Reception hears.
  const catcher = useRef(null)
  const t0 = useRef(0)
  const flushTimer = useRef(null)
  useEffect(() => {
    const grab = () => { const el = catcher.current; if (el && document.activeElement !== el) el.focus() }
    grab()
    const id = setInterval(grab, 500)
    window.addEventListener('focus', grab)
    return () => { clearInterval(id); window.removeEventListener('focus', grab) }
  }, [])
  function flushCatcher(endedBy) {
    if (flushTimer.current) { clearTimeout(flushTimer.current); flushTimer.current = null }
    const el = catcher.current
    if (!el) return
    const v = el.value.trim()
    el.value = ''
    if (v) addRead({ source: '⌨ Keyboard / QR gun', raw: v, endedBy, ms: t0.current ? Date.now() - t0.current : 0 })
    t0.current = 0
  }

  const okCount = useMemo(() => log.filter((r) => r.match).length, [log])

  return (
    <div className="page wide" onClick={() => catcher.current?.focus()}>
      <input
        ref={catcher} className="scan-catcher" inputMode="none" autoFocus autoComplete="off"
        aria-label="Scan capture"
        onKeyDown={(e) => { if (e.key === 'Enter') flushCatcher('Enter') }}
        onInput={() => {
          if (!t0.current) t0.current = Date.now()
          if (flushTimer.current) clearTimeout(flushTimer.current)
          flushTimer.current = setTimeout(() => flushCatcher('pause'), 250)
        }}
      />
      <header className="topbar">
        <div>
          <div className="brand"><span className="leaf">🌿</span>Reader test</div>
          <div className="muted small">Testing only — nothing is saved, nobody is charged.</div>
        </div>
        <div className="row gap">
          <Link className="btn ghost small" to="/admin">‹ Reception</Link>
          <Link className="btn ghost small" to="/owner">Owner</Link>
        </div>
      </header>

      {/* Live health tiles */}
      <section className="mstats">
        <div className="mstat">
          <div className="mstat-val">{focused ? '✓' : '✗'}</div>
          <div className="mstat-lbl" style={{ color: focused ? undefined : 'var(--danger)' }}>
            {focused ? 'Window focused — gun can type here' : 'CLICK THIS WINDOW — gun is typing into nothing'}
          </div>
        </div>
        <div className="mstat">
          <div className="mstat-val">{bridgeUp === true ? '✓' : bridgeUp === false ? '✗' : '…'}</div>
          <div className="mstat-lbl" style={{ color: bridgeUp === false ? 'var(--danger)' : undefined }}>
            {bridgeUp === true ? 'USB bridge connected' : bridgeUp === false ? 'USB bridge NOT running (start_pcsc.bat)' : 'Checking USB bridge…'}
          </div>
        </div>
        <div className="mstat"><div className="mstat-val">{log.length}</div><div className="mstat-lbl">Reads received</div></div>
        <div className="mstat"><div className="mstat-val">{okCount}</div><div className="mstat-lbl">Matched a member</div></div>
      </section>

      {!focused && (
        <div className="gfeed-focuswarn" onClick={() => window.focus()}>
          ⚠ Click anywhere on this page, then scan / tap again.
        </div>
      )}

      <div className="grid2">
        {/* Built-in known QR: scanning THIS with the gun proves the whole path. */}
        <div className="card center-text">
          <h3 style={{ marginTop: 0 }}>1 · Scan this with the QR gun</h3>
          <div className="qrwrap">
            <QRCodeCanvas value="TEST-QR-OK" size={360} level="M" includeMargin style={{ width: 180, height: 180 }} />
          </div>
          <p className="muted small">
            A row must appear below showing <b>TEST-QR-OK</b> and you'll hear the app's ding.
            Gun beeps but no row? The window wasn't focused — or the gun isn't in keyboard (HID) mode.
          </p>
        </div>

        <div className="card">
          <h3 style={{ marginTop: 0 }}>2 · Then test the real things</h3>
          <ul className="tight muted small" style={{ paddingLeft: 18, lineHeight: 1.8 }}>
            <li><b>Member pass QR</b> (phone / card back) → should show the member's name + credits.</li>
            <li><b>NFC card on the USB reader</b> → source shows "USB", with the card's UID. Needs the bridge running on this PC.</li>
            <li><b>Blank / unknown card</b> → shows "no member match" — that's correct; assign it from Reception.</li>
            <li>Reads here are <b>never charged</b> — test as many times as you like.</li>
          </ul>
        </div>
      </div>

      {/* The echo log */}
      <div className="card">
        <div className="row between"><h3 style={{ margin: 0 }}>Every read the app received</h3>
          {log.length > 0 && <button className="btn ghost small" onClick={() => setLog([])}>Clear</button>}
        </div>
        {log.length === 0 && (
          <div className="empty"><span className="ico">📡</span><div className="t">Nothing received yet</div><div className="small">Scan the test QR above, or tap a card on the USB reader.</div></div>
        )}
        {log.map((r) => (
          <div key={r.id} className="hist-row">
            <span className={`hist-ico ${r.match ? 'in' : 'out'}`}>{r.match ? '✓' : r.raw === 'TEST-QR-OK' ? '🎯' : '?'}</span>
            <div className="hist-body">
              <div className="hist-title">
                {r.raw === 'TEST-QR-OK'
                  ? 'TEST QR read perfectly — gun works ✓'
                  : r.match
                    ? `${r.match.name}${r.match.couple ? ' 👫' : ''} · ${r.match.credits} credits`
                    : 'No member match'}
              </div>
              <div className="muted small" style={{ wordBreak: 'break-all' }}>
                {r.source} · {r.raw.length} chars{r.ms ? ` · ${r.ms} ms` : ''} · ended by {r.endedBy}
                <br />raw: <b>{r.raw.length > 60 ? `${r.raw.slice(0, 60)}…` : r.raw}</b>
                {r.code !== r.raw && <> → normalized: <b>{r.code}</b></>}
              </div>
            </div>
            <span className="muted small">{r.time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
