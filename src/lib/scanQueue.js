// Offline-tolerant scan queue. If a check-in can't reach the server (wifi drop),
// the booking token is parked here and replayed when the connection returns.
// Check-in is idempotent server-side, so replaying is always safe.

const KEY = 'scan_queue'

function read() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '[]')
  } catch {
    return []
  }
}

function write(arr) {
  localStorage.setItem(KEY, JSON.stringify(arr))
}

export function enqueue(token, gate) {
  const arr = read()
  if (arr.some((x) => x.token === token)) return // already queued
  arr.push({ token, gate, at: Date.now() })
  write(arr)
}

export function getQueue() {
  return read()
}

export function removeFromQueue(token) {
  write(read().filter((x) => x.token !== token))
}

export function queueSize() {
  return read().length
}
