import { useEffect, useRef } from 'react'
import { normalizeCode } from './readerId'

// Polls the local card-bridge server and fires onTap(uid, reader) whenever a
// new card is published — works regardless of window focus, no keyboard
// typing. Silently does nothing if the bridge isn't running.
//
// Works with both bridges:
//  - card_bridge.py  (old, single reader)  -> {seq, uid}
//  - pcsc_bridge.py  (new, ACS multi-reader) -> {seq, uid, reader: desk|gate1|gate2}
const BRIDGE_BASE = 'http://127.0.0.1:47113'
const BRIDGE = `${BRIDGE_BASE}/tap`

export function useLocalReader(onTap) {
  const cb = useRef(onTap)
  cb.current = onTap
  const lastSeq = useRef(null)

  useEffect(() => {
    let stopped = false
    async function poll() {
      try {
        const r = await fetch(BRIDGE, { cache: 'no-store' })
        const d = await r.json()
        if (lastSeq.current === null) {
          lastSeq.current = d.seq // ignore whatever was already there on load
        } else if (d.seq > lastSeq.current) {
          lastSeq.current = d.seq
          if (d.uid) cb.current(normalizeCode(d.uid), d.reader || '')
        }
      } catch {
        /* bridge not running / not reachable — ignore */
      }
    }
    const id = setInterval(() => { if (!stopped) poll() }, 120)
    poll()
    return () => { stopped = true; clearInterval(id) }
  }, [])
}

// One-shot: resolve the NEXT card tapped on the bridge (for card issuance).
// Only accepts taps from the DESK reader on the multi-reader bridge, so a
// door tap can never be assigned to a member by mistake. (The old bridge
// sends no reader field — those taps are accepted for compatibility.)
// Returns a cancel function.
export function captureNextCard(onCode) {
  let baseSeq = null
  let stopped = false
  async function tick() {
    if (stopped) return
    try {
      const r = await fetch(BRIDGE, { cache: 'no-store' })
      const d = await r.json()
      if (baseSeq === null) {
        baseSeq = d.seq
      } else if (d.seq > baseSeq && d.uid && (!d.reader || d.reader === 'desk')) {
        stopped = true
        clearInterval(id)
        onCode(normalizeCode(d.uid))
      }
    } catch {
      /* bridge not running — ignore */
    }
  }
  const id = setInterval(tick, 200)
  tick()
  return () => { stopped = true; clearInterval(id) }
}

// Flash the reader's LED / buzzer: green+beep on ok, red+double-beep on deny.
// Best-effort — the tap flow never depends on it.
export function sendReaderFeedback(reader, ok) {
  try {
    fetch(`${BRIDGE_BASE}/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reader, ok }),
    }).catch(() => {})
  } catch {
    /* ignore */
  }
}
