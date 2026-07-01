// Per-device access for code-gated pages (admin / scanner). The code a device
// last unlocked with is remembered in localStorage; if the owner regenerates
// the code, the stored one no longer matches and the device is locked out.

export function rememberAccess(kind, code) {
  localStorage.setItem(`access_${kind}`, code)
}

export function getRemembered(kind) {
  return localStorage.getItem(`access_${kind}`) || ''
}

export function clearAccess(kind) {
  localStorage.removeItem(`access_${kind}`)
}

// Random 6-digit code (crypto-backed).
export function generateCode() {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1000000
  return String(n).padStart(6, '0')
}
