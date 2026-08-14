import { useEffect, useState } from 'react'

// "Get the app" — puts this site on the member's home screen as a real app
// icon (it IS the app: same page, full screen, no browser bar).
//
// Android Chrome fires `beforeinstallprompt` once, early — often before React
// mounts — so it's caught here at module load and kept for the button.
// iPhones have no install API at all: Apple only allows Share → Add to Home
// Screen by hand, so there the button opens a picture-guide instead.
let deferredPrompt = null
const listeners = new Set()
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferredPrompt = e
    listeners.forEach((fn) => fn())
  })
}

const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true

export default function InstallApp() {
  const [installed, setInstalled] = useState(isStandalone)
  const [havePrompt, setHavePrompt] = useState(() => !!deferredPrompt)
  const [guide, setGuide] = useState(false)
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent)

  useEffect(() => {
    const fn = () => setHavePrompt(true)
    listeners.add(fn)
    const done = () => setInstalled(true)
    window.addEventListener('appinstalled', done)
    return () => { listeners.delete(fn); window.removeEventListener('appinstalled', done) }
  }, [])

  if (installed) return null // already on their home screen — job done

  async function install() {
    if (deferredPrompt) {
      deferredPrompt.prompt()
      const { outcome } = await deferredPrompt.userChoice
      deferredPrompt = null
      setHavePrompt(false)
      if (outcome === 'accepted') setInstalled(true)
      return
    }
    setGuide(true) // iPhone, or browser without the prompt — show the steps
  }

  return (
    <>
      <button type="button" className="install-strip" onClick={install}>
        <img src="/icons/icon-192.png" alt="" />
        <span className="install-body">
          <b>Get the mobile app</b>
          <span>One tap on your home screen — pass, credits, photo.</span>
        </span>
        <span className="install-go">{havePrompt ? 'Install' : 'How?'} ›</span>
      </button>

      {guide && (
        <div className="recharge-overlay" onClick={() => setGuide(false)}>
          <div className="recharge-panel" onClick={(e) => e.stopPropagation()}>
            <div className="recharge-head">
              <img src="/icons/icon-192.png" alt="" style={{ borderRadius: 14 }} />
              <div>
                <div className="recharge-name">Add to your home screen</div>
                <div className="muted small">Takes 10 seconds — then it opens like any app.</div>
              </div>
              <button className="btn ghost small" onClick={() => setGuide(false)}>✕</button>
            </div>
            {ios ? (
              <ol className="install-steps">
                <li>Tap the <b>Share</b> button <span className="install-key">⬆</span> at the bottom of Safari.</li>
                <li>Scroll down and tap <b>Add to Home Screen</b> <span className="install-key">➕</span>.</li>
                <li>Tap <b>Add</b> — the 🌿 icon appears with your other apps.</li>
              </ol>
            ) : (
              <ol className="install-steps">
                <li>Tap the <b>⋮ menu</b> at the top-right of Chrome.</li>
                <li>Tap <b>Add to Home screen</b> (or <b>Install app</b>).</li>
                <li>Tap <b>Add</b> — the 🌿 icon appears with your other apps.</li>
              </ol>
            )}
            <p className="muted small" style={{ margin: '12px 0 0' }}>
              It's the same page you're on now — just one tap away, full screen, always logged in.
            </p>
          </div>
        </div>
      )}
    </>
  )
}
