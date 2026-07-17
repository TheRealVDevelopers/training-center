import { useState } from 'react'
import { Link } from 'react-router-dom'

// Printer test card. FRONT: full color showcase (primary bars, gradients,
// skin tones, fine text) to judge color rendering. BACK: pure black flood to
// judge K-panel density. Both faces carry a 0.4mm edge frame — if any side of
// the frame is missing on the printed card, the print is shifted that way.
export default function TestCard() {
  const [side, setSide] = useState('both')

  function printTest(s) {
    setSide(s)
    setTimeout(() => window.print(), 80)
  }

  return (
    <div className="page wide cardstudio">
      <div className="cardstudio-ui">
        <header className="topbar">
          <div>
            <div className="brand"><span className="leaf">🌿</span>Printer Test Card</div>
            <div className="muted small">Front: full color showcase · Back: pure black · edge frame = centering check</div>
          </div>
          <Link className="btn ghost small" to="/admin/print">‹ Card Studio</Link>
        </header>

        <div className="card">
          <div className="row gap">
            <button className="btn primary" onClick={() => printTest('both')}>🖨 Print TEST CARD (color + black)</button>
            <button className="btn small" onClick={() => printTest('front')}>Color side only</button>
            <button className="btn small" onClick={() => printTest('back')}>Black side only</button>
          </div>
          <p className="muted small" style={{ margin: '10px 0 0' }}>
            In Chrome's dialog tick <b>More settings → Background graphics</b>. After printing, check: all 7 color bars distinct ·
            gradients smooth (no banding) · small text readable · black side deep and even · the thin frame visible on all 4 edges of both sides.
          </p>
        </div>

        <div className="cs-previews">
          <div><div className="cs-lbl">FRONT · COLOR SHOWCASE</div><ColorFace /></div>
          <div><div className="cs-lbl">BACK · PURE BLACK</div><BlackFace /></div>
        </div>
      </div>

      <div className="cs-printzone">
        <style>{`@media print { @page { size: 86mm 54mm; margin: 0; } }`}</style>
        {(side === 'both' || side === 'front') && <div className="cs-sheet"><ColorFace /></div>}
        {(side === 'both' || side === 'back') && <div className="cs-sheet"><BlackFace /></div>}
      </div>
    </div>
  )
}

function ColorFace() {
  return (
    <div className="pc-face tc-face">
      <div className="tc-frame" />
      <div className="tc-title">EVOLIS ASMI · COLOR TEST</div>
      <div className="tc-bars">
        {['#FFD700', '#FF00FF', '#00FFFF', '#000000', '#FF0000', '#00A651', '#0057FF'].map((c) => (
          <span key={c} style={{ background: c }} />
        ))}
      </div>
      <div className="tc-grad rainbow" />
      <div className="tc-grad gray" />
      <div className="tc-patches">
        <span style={{ background: '#f6c8a0' }}>skin 1</span>
        <span style={{ background: '#8d5a3b', color: '#fff' }}>skin 2</span>
        <span style={{ background: '#00a651', color: '#fff' }}>brand</span>
        <span style={{ background: '#a8790f', color: '#fff' }}>gold</span>
      </div>
      <div className="tc-text">
        <span className="t6">6pt — The quick brown fox jumps over the lazy dog 0123456789</span>
        <span className="t5">5pt — The quick brown fox jumps over the lazy dog 0123456789</span>
        <span className="t4">4pt — The quick brown fox jumps over the lazy dog 0123456789</span>
      </div>
    </div>
  )
}

function BlackFace() {
  return (
    <div className="pc-face tc-face tc-black">
      <div className="tc-frame white" />
      <div className="tc-black-label">PURE BLACK · K PANEL DENSITY TEST</div>
    </div>
  )
}
