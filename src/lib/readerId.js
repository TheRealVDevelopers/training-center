// Keyboard-mode NFC/QR readers append stray whitespace and vary in letter case.
// Every code — whether captured at "assign card" time or "scan to enter" time —
// passes through here so the two always compare equal. Without this, a card
// assigned on one reader can fail to match when read on another.
//
//  - Card UIDs are short hex strings (a 6-byte NTAG UID = 12 hex chars). We
//    upper-case those so byte value, not case, is all that matters.
//  - Member tokens / QR payloads are long opaque strings (32 chars) — left as-is.
export function normalizeCode(raw) {
  if (raw == null) return ''
  const s = String(raw).replace(/\s+/g, '') // readers add stray spaces/newlines
  if (/^[0-9a-fA-F]{4,14}$/.test(s)) return s.toUpperCase() // a hardware UID
  return s // opaque token / QR — untouched
}
