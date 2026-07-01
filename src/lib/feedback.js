// Sound + haptic feedback for the door. Tones are generated with the Web Audio
// API (no audio files). Browsers need a user gesture before audio plays, so
// call primeAudio() once on the first tap.

let ctx
function getCtx() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext
    if (AC) ctx = new AC()
  }
  if (ctx && ctx.state === 'suspended') ctx.resume()
  return ctx
}

export function primeAudio() {
  getCtx()
}

function tone(freq, start, dur, peak = 0.3) {
  const c = getCtx()
  if (!c) return
  const o = c.createOscillator()
  const g = c.createGain()
  o.connect(g)
  g.connect(c.destination)
  o.type = 'sine'
  o.frequency.value = freq
  const t = c.currentTime + start
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(peak, t + 0.01)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  o.start(t)
  o.stop(t + dur + 0.02)
}

// Loud, distinct success / failure beeps for the scanner.
export function beep(ok) {
  try {
    if (ok) {
      tone(880, 0, 0.13)
      tone(1175, 0.12, 0.16) // rising "ding-ding"
    } else {
      tone(200, 0, 0.35) // low buzz
    }
  } catch {
    /* audio unavailable */
  }
}

export function vibrate(ok) {
  try {
    if (navigator.vibrate) navigator.vibrate(ok ? 70 : [50, 45, 90])
  } catch {
    /* haptics unavailable */
  }
}

export function feedback(ok) {
  beep(ok)
  vibrate(ok)
}

// Soft single chime for the admin live counter when a new entry arrives.
export function chime() {
  try {
    tone(660, 0, 0.4, 0.16)
  } catch {
    /* audio unavailable */
  }
}
