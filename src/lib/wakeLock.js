import { useEffect } from 'react'

// Keeps a mounted wall tablet awake so the door/scanner screen never sleeps.
// Uses the Screen Wake Lock API (Chrome/Android, Edge, desktop Chrome). The
// lock drops when the tab is hidden, so we re-acquire it on visibility change.
// A no-op where the API is unavailable — nothing breaks.
export function useWakeLock(active = true) {
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return undefined
    let lock = null
    let released = false

    const acquire = async () => {
      try {
        lock = await navigator.wakeLock.request('screen')
        lock.addEventListener?.('release', () => { lock = null })
      } catch {
        /* denied (e.g. tab not visible) — retry on next visibility change */
      }
    }
    const onVisible = () => {
      if (!released && document.visibilityState === 'visible' && !lock) acquire()
    }

    acquire()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      released = true
      document.removeEventListener('visibilitychange', onVisible)
      try { lock?.release?.() } catch { /* ignore */ }
      lock = null
    }
  }, [active])
}
