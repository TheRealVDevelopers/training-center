import {
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  runTransaction,
  serverTimestamp,
} from 'firebase/firestore'
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage'
import { db, storage } from '../firebase'
import { PACK_CREDITS, packPrice } from '../config'
import { normalizeCode } from './readerId'
import { currentActor } from './actor'

// ============================================================================
// THE MODEL — one sentence each:
//   members       one doc per person · wallet holds CREDITS (1 credit = 1 entry)
//   entries       one doc per member per session → double-charge is impossible
//   transactions  append-only ledger: every recharge / entry / correction
//   scanEvents    the live board's feed (green + red rows, incl. denials)
//   sessions      one per Saturday · auto-starts on the first tap
//   settings      the 4-digit staff PIN
// ============================================================================

export function makeToken() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID().replace(/-/g, '')
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

// ---- Members ---------------------------------------------------------------

export async function createMemberProfile(uid, data) {
  await setDoc(doc(db, 'members', uid), {
    name: data.name || '',
    mobile: data.mobile || '',
    email: data.email || '',
    tier: data.tier || 'Associate',
    clubName: data.clubName || '',
    city: data.city || '',
    years: data.years || '',
    photoURL: data.photoURL || '',
    credits: 0,
    couple: !!data.couple,
    cardUid: null,
    memberToken: makeToken(),
    cardPrinted: false,
    cardGiven: false,
    role: 'member',
    createdAt: serverTimestamp(),
  })
}

// Owner adds someone without a smartphone/email: profile only, no login.
// Their card and QR work immediately; an email login can be attached later.
export async function addMemberDirect(data) {
  const refM = doc(collection(db, 'members'))
  await setDoc(refM, {
    name: data.name || '',
    mobile: data.mobile || '',
    email: data.email || '',
    tier: data.tier || 'Associate',
    clubName: data.clubName || '',
    city: data.city || '',
    years: '',
    photoURL: '',
    credits: 0,
    couple: !!data.couple,
    cardUid: null,
    memberToken: makeToken(),
    cardPrinted: false,
    cardGiven: false,
    role: 'member',
    noLogin: true,
    createdAt: serverTimestamp(),
  })
  return refM.id
}

export function subscribeMembers(cb) {
  return onSnapshot(collection(db, 'members'), (snap) =>
    cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
  )
}

export async function getMember(id) {
  const snap = await getDoc(doc(db, 'members', id))
  return snap.exists() ? { id: snap.id, ...snap.data() } : null
}

export async function updateMemberProfile(uid, data) {
  await updateDoc(doc(db, 'members', uid), data)
}

export async function deleteMember(uid) {
  await deleteDoc(doc(db, 'members', uid))
}

export async function ensureMemberToken(member) {
  if (member.memberToken) return member.memberToken
  const token = makeToken()
  await updateDoc(doc(db, 'members', member.id), { memberToken: token })
  return token
}

// Link a physical card to a member. A couple needs TWO cards (one each), so
// UIDs live in an array; `cardUid` is kept in sync as the first one for older
// code paths. Assigning a card that already belongs to someone else moves it.
export async function assignCard(memberId, cardUid, membersCache = []) {
  const uid = normalizeCode(cardUid)
  const max = 2

  // Take the card off whoever had it before — a UID can only be in one place.
  const prev = membersCache.find(
    (m) => m.id !== memberId && (m.cardUid === uid || (m.cardUids || []).includes(uid)),
  )
  if (prev) {
    const left = (prev.cardUids || [prev.cardUid]).filter((u) => u && u !== uid)
    await updateDoc(doc(db, 'members', prev.id), { cardUids: left, cardUid: left[0] || null })
  }

  const me = membersCache.find((m) => m.id === memberId)
  const current = (me?.cardUids || (me?.cardUid ? [me.cardUid] : [])).filter(Boolean)
  if (current.includes(uid)) return { already: true, uids: current }
  const next = [...current, uid].slice(-max) // keep the newest, cap at 2
  await updateDoc(doc(db, 'members', memberId), { cardUids: next, cardUid: next[0] })
  return { already: false, uids: next, movedFrom: prev?.name || null }
}

// Take a card off a member (lost / wrongly assigned).
export async function unassignCard(member, cardUid) {
  const uid = normalizeCode(cardUid)
  const left = (member.cardUids || [member.cardUid]).filter((u) => u && u !== uid)
  await updateDoc(doc(db, 'members', member.id), { cardUids: left, cardUid: left[0] || null })
}

// Lost card / lost phone-QR: mint a fresh token so old copies stop working.
export async function replaceToken(memberId) {
  const token = makeToken()
  await updateDoc(doc(db, 'members', memberId), { memberToken: token, cardUid: null })
  return token
}

// Resolve a tapped/scanned code — INSTANTLY from the live cache when possible,
// falling back to a query only on a cold start.
export function resolveMemberLocal(code, membersCache) {
  const c = normalizeCode(code)
  return membersCache?.find(
    (m) => m.memberToken === c || m.cardUid === c || (m.cardUids || []).includes(c),
  ) || null
}
export async function resolveMember(code, membersCache) {
  const local = resolveMemberLocal(code, membersCache)
  if (local) return local
  const c = normalizeCode(code)
  for (const field of ['memberToken', 'cardUid']) {
    const snap = await getDocs(query(collection(db, 'members'), where(field, '==', c), limit(1)))
    if (!snap.empty) return { id: snap.docs[0].id, ...snap.docs[0].data() }
  }
  // Second card of a couple lives in the array.
  const arr = await getDocs(
    query(collection(db, 'members'), where('cardUids', 'array-contains', c), limit(1)),
  )
  if (!arr.empty) return { id: arr.docs[0].id, ...arr.docs[0].data() }
  return null
}

export async function uploadPhoto(path, file) {
  const r = ref(storage, path)
  await uploadBytes(r, file)
  return getDownloadURL(r)
}

// ---- Sessions (auto-start on first tap) ------------------------------------

// Only TODAY's session counts as live. An 'active' session left over from a
// previous day (someone forgot to press End) is ignored and closed, so last
// week's numbers can never leak into this week's board.
export function subscribeActiveSession(cb) {
  const q = query(collection(db, 'sessions'), where('status', '==', 'active'), limit(5))
  return onSnapshot(q, (snap) => {
    const today = sessionIdFor()
    let live = null
    snap.docs.forEach((d) => {
      if (d.id === today) live = { id: d.id, ...d.data() }
      else updateDoc(d.ref, { status: 'ended', endedAt: serverTimestamp() }).catch(() => {})
    })
    cb(live)
  })
}

// The session ID *is* the local date — 'sessions/2026-07-25'. This makes one
// session per day structurally impossible to duplicate: ending a session and
// tapping again re-opens the SAME day instead of creating a second one.
// Always local parts (IST), never toISOString() — a 9pm Saturday must not file
// itself under Sunday.
export function sessionIdFor(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export async function ensureActiveSession() {
  const id = sessionIdFor()
  const ref = doc(db, 'sessions', id)
  const snap = await getDoc(ref)
  if (!snap.exists()) {
    await setDoc(ref, {
      date: id,
      status: 'active',
      startedAt: serverTimestamp(),
      endedAt: null,
    })
    return { id, date: id, status: 'active' }
  }
  const s = snap.data()
  // Re-open today's session if staff ended it and someone else arrives.
  if (s.status !== 'active') {
    await updateDoc(ref, { status: 'active', endedAt: null })
  }
  return { id, ...s, date: s.date || id, status: 'active' }
}

export async function endSession(sessionId) {
  await updateDoc(doc(db, 'sessions', sessionId), { status: 'ended', endedAt: serverTimestamp() })
}

// Past Saturdays, newest first (owner → Today tab).
export function subscribeSessions(cb, max = 30) {
  const q = query(collection(db, 'sessions'), orderBy('startedAt', 'desc'), limit(max))
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
}

// ---- Check-in (the correctness-critical core) ------------------------------
// One entry doc per member per session (`${sessionId}_${memberId}`): the first
// write wins, so no double charge is possible — from any device, ever.

export async function checkIn(member, session, { gate = 'desk', method = 'card' } = {}) {
  const refE = doc(db, 'entries', `${session.id}_${member.id}`)
  const refM = doc(db, 'members', member.id)
  return runTransaction(db, async (tx) => {
    const eSnap = await tx.get(refE)
    const mSnap = await tx.get(refM)
    if (!mSnap.exists()) return { ok: false, kind: 'notreg', member }
    const m = { id: member.id, ...mSnap.data() }

    if (eSnap.exists()) {
      const e = eSnap.data()
      if (e.exitedAt) {
        // Went out earlier, back again — free.
        tx.update(refE, { exitedAt: null, reAt: serverTimestamp() })
        return { ok: true, kind: 'reentry', member: m, credits: m.credits || 0 }
      }
      return { ok: true, kind: 'already', member: m, credits: m.credits || 0 }
    }

    const credits = m.credits || 0
    if (credits < 1) return { ok: false, kind: 'low', member: m, credits: 0 }

    tx.update(refM, { credits: credits - 1 })
    tx.set(refE, {
      sessionId: session.id,
      sessionDate: session.date || session.id, // denormalised: reports group by day
      memberId: m.id,
      name: m.name || '',
      tier: m.tier || '',                      // what was true ON THE DAY
      photoURL: m.photoURL || '',
      couple: !!m.couple,
      guests: 0,
      gate,
      method,
      at: serverTimestamp(),
      exitedAt: null,
    })
    const refT = doc(collection(db, 'transactions'))
    tx.set(refT, {
      memberId: m.id,
      type: 'entry',
      credits: -1,
      amount: 0,
      note: 'Entry',
      sessionId: session.id,
      createdAt: serverTimestamp(),
    })
    return { ok: true, kind: 'welcome', member: m, credits: credits - 1 }
  })
}

// Out-switch tap: mark them gone. Never charges, never refunds.
export async function markExit(member, session) {
  const refE = doc(db, 'entries', `${session.id}_${member.id}`)
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(refE)
    if (!snap.exists()) return { ok: false, kind: 'notin', member }
    if (snap.data().exitedAt) return { ok: true, kind: 'alreadyout', member }
    tx.update(refE, { exitedAt: serverTimestamp() })
    return { ok: true, kind: 'left', member }
  })
}

// Member brought a friend: +1 guest on their entry, −1 credit. One tap.
export async function addGuest(memberId, session) {
  const refE = doc(db, 'entries', `${session.id}_${memberId}`)
  const refM = doc(db, 'members', memberId)
  return runTransaction(db, async (tx) => {
    const eSnap = await tx.get(refE)
    const mSnap = await tx.get(refM)
    if (!eSnap.exists()) throw new Error('They are not checked in yet')
    const credits = mSnap.data()?.credits || 0
    if (credits < 1) throw new Error('No credits for a guest — recharge first')
    tx.update(refM, { credits: credits - 1 })
    tx.update(refE, { guests: (eSnap.data().guests || 0) + 1 })
    const refT = doc(collection(db, 'transactions'))
    tx.set(refT, {
      memberId,
      type: 'entry',
      credits: -1,
      amount: 0,
      note: 'Guest entry',
      sessionId: session.id,
      createdAt: serverTimestamp(),
    })
    return { ok: true, credits: credits - 1 }
  })
}

// ---- Money -----------------------------------------------------------------

// Recharge in packs. ₹ recorded from the member's tier; wallet gains credits.
export async function recharge(memberId, packs, { method = 'cash', ref: reference = '' } = {}) {
  return runTransaction(db, async (tx) => {
    const refM = doc(db, 'members', memberId)
    const snap = await tx.get(refM)
    if (!snap.exists()) throw new Error('Member not found')
    const m = snap.data()
    const credits = PACK_CREDITS * packs
    const amount = packPrice(m.tier) * packs
    tx.update(refM, { credits: (m.credits || 0) + credits })
    const refT = doc(collection(db, 'transactions'))
    tx.set(refT, {
      memberId,
      type: 'recharge',
      credits,
      amount,
      method,
      ref: reference || null,
      note: `Recharge · ${credits} credits`,
      memberName: m.name || '',
      by: currentActor(),               // audit: which desk / who took the money
      createdAt: serverTimestamp(),
    })
    return { credits, amount, total: (m.credits || 0) + credits }
  })
}

// Owner-only: fix a mistake by hand (+/- credits with a required note).
export async function adjustCredits(memberId, delta, note) {
  return runTransaction(db, async (tx) => {
    const refM = doc(db, 'members', memberId)
    const snap = await tx.get(refM)
    if (!snap.exists()) throw new Error('Member not found')
    const now = Math.max(0, (snap.data().credits || 0) + delta)
    tx.update(refM, { credits: now })
    const refT = doc(collection(db, 'transactions'))
    tx.set(refT, {
      memberId,
      type: 'adjust',
      credits: delta,
      amount: 0,
      note: note || 'Adjustment',
      memberName: snap.data().name || '',
      by: currentActor(),
      createdAt: serverTimestamp(),
    })
    return now
  })
}

// Owner-only: delete a wrong recharge; its credits come back off the wallet.
export async function deletePayment(txnId) {
  await runTransaction(db, async (tx) => {
    const refT = doc(db, 'transactions', txnId)
    const tSnap = await tx.get(refT)
    if (!tSnap.exists()) throw new Error('Payment not found')
    const t = tSnap.data()
    if (t.type !== 'recharge' && t.type !== 'topup') throw new Error('Only a recharge can be deleted')
    if (t.memberId) {
      const refM = doc(db, 'members', t.memberId)
      const mSnap = await tx.get(refM)
      if (mSnap.exists()) {
        // New rows carry credits; legacy topups carry only ₹ (₹300 = 1 credit).
        const back = t.credits ?? Math.floor((t.amount || 0) / 300)
        tx.update(refM, { credits: Math.max(0, (mSnap.data().credits || 0) - back) })
      }
    }
    tx.delete(refT)
  })
}

// ---- Live data -------------------------------------------------------------

export function subscribeSessionEntries(sessionId, cb) {
  const q = query(collection(db, 'entries'), where('sessionId', '==', sessionId))
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
}

// One member's whole attendance history (member profile, own dashboard).
// Needs the composite index memberId ASC + at DESC (firestore.indexes.json).
export function subscribeMemberEntries(memberId, cb, max = 120) {
  const q = query(
    collection(db, 'entries'),
    where('memberId', '==', memberId),
    orderBy('at', 'desc'),
    limit(max),
  )
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
}

// Every entry in a date range — powers month reports and the matrix.
// Dates are 'YYYY-MM-DD' strings, so a plain range query works.
export function subscribeEntriesBetween(fromDate, toDate, cb) {
  const q = query(
    collection(db, 'entries'),
    where('sessionDate', '>=', fromDate),
    where('sessionDate', '<=', toDate),
  )
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
}

export function subscribeMemberHistory(memberId, cb) {
  const q = query(collection(db, 'transactions'), where('memberId', '==', memberId))
  return onSnapshot(q, (snap) => {
    const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    items.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0))
    cb(items)
  })
}

// All money rows (owner → Money tab filters by day client-side; small scale).
export function subscribeAllPayments(cb) {
  const q = query(collection(db, 'transactions'), where('type', 'in', ['recharge', 'topup']))
  return onSnapshot(q, (snap) => {
    const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    items.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0))
    cb(items)
  })
}

// The board's feed — every tap outcome, including red denials.
export function logScanEvent(evt) {
  addDoc(collection(db, 'scanEvents'), { ...evt, at: serverTimestamp() }).catch(() => {})
}
export function subscribeScanEvents(cb, max = 60) {
  const q = query(collection(db, 'scanEvents'), orderBy('at', 'desc'), limit(max))
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
}

// ---- Settings (staff PIN) --------------------------------------------------

export function subscribeSettings(cb) {
  return onSnapshot(doc(db, 'settings', 'access'), (snap) => cb(snap.exists() ? snap.data() : {}))
}
export async function setStaffPin(pin) {
  await setDoc(doc(db, 'settings', 'access'), { staffPin: pin, updatedAt: serverTimestamp() }, { merge: true })
}
