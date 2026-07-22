import { QRCodeCanvas } from 'qrcode.react'

// Print-ready A4 signup poster: stick it at the venue entrance / share the
// photo on WhatsApp. Scanning the QR opens the signup page.
export default function Poster() {
  const url = `${window.location.origin}/signup`
  return (
    <div className="poster-page">
      <div className="poster-bar no-print">
        <span className="muted small">A4 poster — Print (Ctrl+P), or screenshot for WhatsApp</span>
        <button className="btn primary small" onClick={() => window.print()}>🖨 Print</button>
      </div>

      <div className="poster">
        <div className="poster-brand">🌿 SATURDAY TRAINING</div>
        <div className="poster-club">HERBALIFE NUTRITION CLUB</div>

        <h1 className="poster-title">Become a member<br />in 30 seconds</h1>

        <div className="poster-qr">
          <QRCodeCanvas value={url} size={640} level="M" includeMargin bgColor="#ffffff" fgColor="#0a130e" style={{ width: '64mm', height: '64mm' }} />
        </div>
        <div className="poster-scan">📱 SCAN TO REGISTER</div>
        <div className="poster-url">{url.replace(/^https?:\/\//, '')}</div>

        <ol className="poster-steps">
          <li><b>Scan &amp; register</b> — name, photo, level. Once, forever.</li>
          <li><b>Recharge at the desk</b> — one pack = 5 entries.</li>
          <li><b>Tap your card &amp; walk in</b> — every Saturday. That's it.</li>
        </ol>

        <div className="poster-foot">POWERED BY THE REAL V DEVELOPERS · THEREALVDEVELOPERS.IN</div>
      </div>
    </div>
  )
}
