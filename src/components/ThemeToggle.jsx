import { useState } from 'react'
import { getTheme, setTheme } from '../lib/theme'

// ☀️ / 🌙 switch — shows the mode you'll switch TO.
export default function ThemeToggle() {
  const [t, setT] = useState(getTheme())
  function flip() {
    const next = t === 'light' ? 'dark' : 'light'
    setTheme(next)
    setT(next)
  }
  return (
    <button className="btn ghost small" onClick={flip} title="Day / night theme">
      {t === 'light' ? '🌙' : '☀️'}
    </button>
  )
}
