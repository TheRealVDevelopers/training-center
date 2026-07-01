import { useEffect, useRef, useState } from 'react'

// Animated number that eases from its previous value to the new one.
export default function CountUp({ value = 0, prefix = '', duration = 650 }) {
  const [display, setDisplay] = useState(value)
  const fromRef = useRef(value)

  useEffect(() => {
    const from = fromRef.current
    const to = value
    if (from === to) {
      setDisplay(to)
      return
    }
    let raf
    const start = performance.now()
    const step = (t) => {
      const p = Math.min(1, (t - start) / duration)
      const eased = 1 - Math.pow(1 - p, 3)
      setDisplay(Math.round(from + (to - from) * eased))
      if (p < 1) raf = requestAnimationFrame(step)
      else fromRef.current = to
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [value, duration])

  return (
    <>
      {prefix}
      {display}
    </>
  )
}
