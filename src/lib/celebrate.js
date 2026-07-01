// Lightweight confetti burst — no dependencies. Used on booking success and
// door check-in to make the moment feel rewarding.
export function confetti(count = 34) {
  try {
    const colors = ['#00c853', '#a3e635', '#00a651', '#f5b400', '#2fe07a', '#06b6d4']
    const root = document.createElement('div')
    root.className = 'confetti-root'
    for (let i = 0; i < count; i++) {
      const p = document.createElement('span')
      p.className = 'confetti-piece'
      p.style.left = Math.random() * 100 + '%'
      p.style.background = colors[i % colors.length]
      p.style.animationDelay = (Math.random() * 0.15).toFixed(2) + 's'
      p.style.setProperty('--x', (Math.random() * 2 - 1).toFixed(2))
      p.style.setProperty('--r', Math.round(Math.random() * 540) + 'deg')
      root.appendChild(p)
    }
    document.body.appendChild(root)
    setTimeout(() => root.remove(), 1800)
  } catch {
    /* no-op */
  }
}
