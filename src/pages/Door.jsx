import { QRCodeCanvas } from 'qrcode.react'
import { useWakeLock } from '../lib/wakeLock'

// Door screen — nothing but a big QR. Anyone standing at the door scans it with
// their phone to open the read-only live board (/feed) and watch entries roll
// in. The actual card taps are handled by the readers wired to the reception
// PC, so this screen needs no reader, no buttons — just the code.
export default function Door() {
  useWakeLock(true) // keep the door display awake
  const url = `${window.location.origin}/feed`

  return (
    <div className="doorqr">
      <div className="doorqr-brand"><span className="leaf">🌿</span> Saturday Training</div>
      <div className="doorqr-card">
        <QRCodeCanvas value={url} size={520} level="M" includeMargin bgColor="#ffffff" fgColor="#0a130e" style={{ width: '100%', height: 'auto', maxWidth: 420 }} />
      </div>
      <div className="doorqr-title">📲 Scan to watch live entries</div>
      <div className="doorqr-sub">Point your phone camera here — see everyone entering, with a red ✗ for anyone out of credits.</div>
    </div>
  )
}
