import { useEffect, useRef } from 'react'
import { normalizeCode } from './readerId'

// USB card readers in "keyboard mode" type the card's id fast, then Enter.
// This captures that burst globally (ignoring real input fields) and calls
// onCode(id). Works identically on Windows, Mac, Linux — it's just keystrokes.
export function useCardWedge(onCode, enabled = true) {
  const cb = useRef(onCode)
  cb.current = onCode
  const buf = useRef('')
  const timer = useRef(null)

  useEffect(() => {
    if (!enabled) return undefined
    const flush = () => {
      const v = normalizeCode(buf.current)
      buf.current = ''
      if (v.length >= 3) cb.current(v)
    }
    const onKey = (e) => {
      // Don't hijack typing into a real field (e.g. the name-search box).
      const tag = (e.target?.tagName || '').toLowerCase()
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return
      if (e.key === 'Enter') {
        if (timer.current) clearTimeout(timer.current)
        flush()
      } else if (e.key.length === 1) {
        buf.current += e.key
        if (timer.current) clearTimeout(timer.current)
        timer.current = setTimeout(flush, 120) // reader bursts fast; a pause = end
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      if (timer.current) clearTimeout(timer.current)
    }
  }, [enabled])
}

// One-shot: arm capture of the next card tap regardless of focus (for issuing
// a card at the admin desk). Returns a cleanup function.
export function captureOneCard(onCode) {
  let buf = ''
  let timer = null
  const done = () => {
    window.removeEventListener('keydown', onKey)
    if (timer) clearTimeout(timer)
    const v = normalizeCode(buf)
    if (v.length >= 3) onCode(v)
    else onCode('')
  }
  const onKey = (e) => {
    if (e.key === 'Enter') {
      done()
    } else if (e.key.length === 1) {
      buf += e.key
      if (timer) clearTimeout(timer)
      timer = setTimeout(done, 150)
    }
  }
  window.addEventListener('keydown', onKey)
  return () => {
    window.removeEventListener('keydown', onKey)
    if (timer) clearTimeout(timer)
  }
}
