// Web NFC — works only in Chrome on Android (over HTTPS), after a user gesture.
// Every function feature-detects and throws a friendly message elsewhere.

export function nfcSupported() {
  return typeof window !== 'undefined' && 'NDEFReader' in window
}

// Start reading. onToken(token, serial) fires on every tap. Returns a stop fn.
export async function startNfcRead(onToken, onError) {
  if (!nfcSupported()) {
    throw new Error('NFC needs an Android phone with Chrome. Use the QR scanner instead.')
  }
  const ndef = new NDEFReader()
  const controller = new AbortController()
  await ndef.scan({ signal: controller.signal }) // prompts for permission on first use

  ndef.onreadingerror = () => onError && onError('Could not read the card — tap it flat and try again.')
  ndef.onreading = (event) => {
    let token = ''
    for (const record of event.message.records || []) {
      if (record.recordType === 'text') {
        try {
          token = new TextDecoder(record.encoding || 'utf-8').decode(record.data)
        } catch {
          /* ignore malformed record */
        }
      }
    }
    // Fallback: a blank/unwritten card still has a hardware serial number.
    if (!token && event.serialNumber) token = 'uid:' + event.serialNumber
    if (token) onToken(token.trim(), event.serialNumber || '')
  }

  return () => {
    try {
      controller.abort()
    } catch {
      /* already stopped */
    }
  }
}

// Write a token onto a blank card (card issuance). Resolves when the tap writes.
export async function writeNfc(token) {
  if (!nfcSupported()) {
    throw new Error('NFC writing needs an Android phone with Chrome.')
  }
  const ndef = new NDEFReader()
  await ndef.write({ records: [{ recordType: 'text', data: token }] })
}
