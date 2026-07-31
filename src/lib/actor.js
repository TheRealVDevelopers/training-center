import { auth } from '../firebase'

// Who is doing this? Staff devices sign in anonymously, so they are identified
// by a device label the club sets once per machine ("Front desk", "Desk 2").
// The owner is identified by their email. Every money row records this, which
// is what makes a cash dispute answerable later.
export function currentActor() {
  const u = auth.currentUser
  if (!u) return { uid: null, kind: 'unknown', label: 'Unknown' }
  if (u.isAnonymous) {
    return { uid: u.uid, kind: 'staff', label: getDeviceLabel() }
  }
  return { uid: u.uid, kind: 'owner', label: u.email || 'Owner' }
}

export function getDeviceLabel() {
  try { return localStorage.getItem('device_label') || 'Reception' } catch { return 'Reception' }
}

export function setDeviceLabel(label) {
  try { localStorage.setItem('device_label', label) } catch { /* private mode */ }
}
