import { useEffect, useRef } from 'react'

// Polls the local card-bridge server (card_bridge.py) and fires onTap(uid)
// whenever a new card is published — works regardless of window focus, no
// keyboard typing. Silently does nothing if the bridge isn't running.
const BRIDGE = 'http://127.0.0.1:47113/tap'

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
          if (d.uid) cb.current(d.uid)
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
      } else if (d.seq > baseSeq && d.uid) {
        stopped = true
        clearInterval(id)
        onCode(d.uid)
      }
    } catch {
      /* bridge not running — ignore */
    }
  }
  const id = setInterval(tick, 200)
  tick()
  return () => { stopped = true; clearInterval(id) }
}
