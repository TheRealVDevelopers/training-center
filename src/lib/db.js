import {
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  addDoc,
  updateDoc,
  query,
  where,
  limit,
  onSnapshot,
  runTransaction,
  serverTimestamp,
} from 'firebase/firestore'
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage'
import { db, storage } from '../firebase'
import { SESSION } from '../config'

// Opaque, unguessable token. Doubles as the booking document id and the QR
// payload — so the scanner can look up the booking directly without a query.
export function makeToken() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID().replace(/-/g, '')
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

// ---- Members --------------------------------------------------------------

export async function createMemberProfile(uid, data) {
  await setDoc(doc(db, 'members', uid), {
    name: data.name,
    mobile: data.mobile,
    email: data.email,
    info: data.info || '',
    photoURL: data.photoURL || '',
    balance: 0, // money in the wallet
    reserved: 0, // money held by active (pending) bookings, not yet deducted
    role: 'member',
    createdAt: serverTimestamp(),
  })
}

export async function updateMemberProfile(uid, data) {
  await updateDoc(doc(db, 'members', uid), data)
}

export async function uploadPhoto(path, file) {
  const r = ref(storage, path)
  await uploadBytes(r, file)
  return getDownloadURL(r)
}

export function subscribeMembers(cb) {
  return onSnapshot(collection(db, 'members'), (snap) =>
    cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
  )
}

// Admin: add credit (top-up) and record it in the transactions ledger.
export async function addCredit(memberId, amount, note) {
  await runTransaction(db, async (tx) => {
    const refM = doc(db, 'members', memberId)
    const snap = await tx.get(refM)
    if (!snap.exists()) throw new Error('Member not found')
    const bal = snap.data().balance || 0
    tx.update(refM, { balance: bal + amount })
    const txnRef = doc(collection(db, 'transactions'))
    tx.set(txnRef, {
      memberId,
      type: 'topup',
      amount, // positive
      note: note || 'Top-up',
      createdAt: serverTimestamp(),
    })
  })
}

// ---- Access codes (super admin sets; admin/scanner pages check) -----------

export function subscribeAccessCodes(cb) {
  return onSnapshot(doc(db, 'settings', 'access'), (snap) => cb(snap.exists() ? snap.data() : {}))
}

// which: 'adminCode' | 'scannerCode'
export async function setAccessCode(which, code) {
  await setDoc(
    doc(db, 'settings', 'access'),
    { [which]: code, updatedAt: serverTimestamp() },
    { merge: true },
  )
}

// ---- Sessions -------------------------------------------------------------

export function subscribeActiveSession(cb) {
  const q = query(collection(db, 'sessions'), where('status', '==', 'active'), limit(1))
  return onSnapshot(q, (snap) =>
    cb(snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() }),
  )
}

export async function startSession() {
  const q = query(collection(db, 'sessions'), where('status', '==', 'active'), limit(1))
  const existing = await getDocs(q)
  if (!existing.empty) {
    const d = existing.docs[0]
    return { id: d.id, ...d.data() }
  }
  const created = await addDoc(collection(db, 'sessions'), {
    status: 'active',
    feePerPerson: SESSION.feePerPerson,
    capacity: SESSION.capacity,
    createdAt: serverTimestamp(),
  })
  const d = await getDoc(created)
  return { id: d.id, ...d.data() }
}

// Close the current session so a fresh one can start next time. Also cancels
// any still-pending (un-scanned) bookings for it and releases their held funds.
export async function endSession(sessionId) {
  await updateDoc(doc(db, 'sessions', sessionId), {
    status: 'ended',
    endedAt: serverTimestamp(),
  })
  const snap = await getDocs(query(collection(db, 'bookings'), where('sessionId', '==', sessionId)))
  for (const d of snap.docs) {
    if (d.data().status === 'pending') {
      try {
        await cancelBooking(d.id)
      } catch {
        /* best-effort cleanup */
      }
    }
  }
}

// ---- Bookings -------------------------------------------------------------

// type: 'self' | 'self_guest' | 'guest'
// people: [{ name, isGuest, photoURL }]
// Holds (reserves) the fee at booking time so a member can't book more slots
// than their available balance covers. The money stays in the wallet and is
// only deducted at check-in; cancelling releases the hold.
export async function createBooking({ member, session, type, people }) {
  const token = makeToken()
  const peopleCount = people.length
  const totalAmount = peopleCount * session.feePerPerson
  const refB = doc(db, 'bookings', token)
  const refM = doc(db, 'members', member.id)

  await runTransaction(db, async (tx) => {
    const mSnap = await tx.get(refM)
    if (!mSnap.exists()) throw new Error('Member not found')
    const m = mSnap.data()
    const available = (m.balance || 0) - (m.reserved || 0)
    if (available < totalAmount) {
      throw new Error(
        `Not enough available balance (₹${available} < ₹${totalAmount}). Cancel an active booking or top up.`,
      )
    }
    tx.update(refM, { reserved: (m.reserved || 0) + totalAmount })
    tx.set(refB, {
      memberId: member.id,
      memberName: member.name,
      sessionId: session.id,
      type,
      people,
      peopleCount,
      feePerPerson: session.feePerPerson,
      totalAmount,
      status: 'pending', // pending -> checked_in | cancelled
      qrToken: token,
      createdAt: serverTimestamp(),
      checkedInAt: null,
    })
  })
  return token
}

// One member's bookings (sorted client-side to avoid a composite index).
export function subscribeMemberBookings(memberId, cb) {
  const q = query(collection(db, 'bookings'), where('memberId', '==', memberId))
  return onSnapshot(q, (snap) => {
    const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    items.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0))
    cb(items)
  })
}

export function subscribeBooking(bookingId, cb) {
  return onSnapshot(doc(db, 'bookings', bookingId), (snap) =>
    cb(snap.exists() ? { id: snap.id, ...snap.data() } : null),
  )
}

// Used by the scanner's manual lookup (member forgot their phone): find the
// member's still-active bookings, optionally limited to the current session.
export async function findMemberPendingBookings(memberId, sessionId) {
  const snap = await getDocs(query(collection(db, 'bookings'), where('memberId', '==', memberId)))
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((b) => b.status === 'pending' && (!sessionId || b.sessionId === sessionId))
}

// All bookings for a session (admin live view filters/sorts client-side).
export function subscribeSessionBookings(sessionId, cb) {
  const q = query(collection(db, 'bookings'), where('sessionId', '==', sessionId))
  return onSnapshot(q, (snap) =>
    cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
  )
}

export async function cancelBooking(bookingId) {
  await runTransaction(db, async (tx) => {
    const refB = doc(db, 'bookings', bookingId)
    const bSnap = await tx.get(refB)
    if (!bSnap.exists()) throw new Error('Booking not found')
    const b = bSnap.data()
    if (b.status !== 'pending') throw new Error('Only a pending booking can be cancelled')

    // Release the held funds back to the member's available balance.
    const refM = doc(db, 'members', b.memberId)
    const mSnap = await tx.get(refM)
    tx.update(refB, { status: 'cancelled', cancelledAt: serverTimestamp() })
    if (mSnap.exists()) {
      const reserved = mSnap.data().reserved || 0
      tx.update(refM, { reserved: Math.max(0, reserved - b.totalAmount) })
    }
  })
}

// ---- Check-in (the correctness-critical part) -----------------------------
// Atomic: only the FIRST scan of a booking wins. A second scan at any gate
// returns "already entered" and never deducts twice. Runs as a Firestore
// transaction so two volunteers scanning the same code can't both succeed.
export async function checkInByToken(token, gate) {
  const refB = doc(db, 'bookings', token)
  return runTransaction(db, async (tx) => {
    const bSnap = await tx.get(refB)
    if (!bSnap.exists()) return { ok: false, reason: 'invalid', message: 'Invalid QR code' }
    const b = bSnap.data()

    if (b.status === 'cancelled') {
      return { ok: false, reason: 'cancelled', message: 'Booking was cancelled', booking: { id: token, ...b } }
    }
    if (b.status === 'checked_in') {
      return { ok: false, reason: 'already', message: 'Already entered', booking: { id: token, ...b } }
    }

    const refM = doc(db, 'members', b.memberId)
    const mSnap = await tx.get(refM)
    if (!mSnap.exists()) return { ok: false, reason: 'nomember', message: 'Member not found' }
    const balance = mSnap.data().balance || 0
    const reserved = mSnap.data().reserved || 0

    if (balance < b.totalAmount) {
      return {
        ok: false,
        reason: 'insufficient',
        message: `Low balance (₹${balance} < ₹${b.totalAmount})`,
        booking: { id: token, ...b },
      }
    }

    // Deduct from the wallet and release this booking's hold in one step.
    tx.update(refM, {
      balance: balance - b.totalAmount,
      reserved: Math.max(0, reserved - b.totalAmount),
    })
    tx.update(refB, {
      status: 'checked_in',
      checkedInAt: serverTimestamp(),
      gate: gate || null,
    })
    const txnRef = doc(collection(db, 'transactions'))
    tx.set(txnRef, {
      memberId: b.memberId,
      type: 'deduction',
      amount: -b.totalAmount,
      bookingId: token,
      note: `Check-in · ${b.peopleCount} ${b.peopleCount > 1 ? 'people' : 'person'}`,
      createdAt: serverTimestamp(),
    })

    return {
      ok: true,
      reason: 'checked_in',
      message: 'Entry allowed',
      booking: { id: token, ...b },
      deducted: b.totalAmount,
      remaining: balance - b.totalAmount,
    }
  })
}

// ---- Transactions ledger (member history) ---------------------------------

export function subscribeTransactions(memberId, cb) {
  const q = query(collection(db, 'transactions'), where('memberId', '==', memberId))
  return onSnapshot(q, (snap) => {
    const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    items.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0))
    cb(items)
  })
}
