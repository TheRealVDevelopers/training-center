// CUTOVER migration: ₹ wallets → credit wallets. Run once, together with
// deploying the credits-model build. A full backup must exist first.
//
//   credits = floor(balance / 300)  — ₹300 was the price everyone actually
//   paid per entry, so nobody gains or loses an entry in the conversion.
//
// Also: drops dead fields (balance, reserved, position, level, walletOwnerId,
// partnerId), guarantees couple/cardPrinted/cardGiven exist, gives sessions a
// startedAt, and ends any active session so the new world starts clean.
//
// Usage: node scripts/migrate-credits.mjs <serviceAccount.json>

import { readFileSync } from 'fs'
import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'

initializeApp({ credential: cert(JSON.parse(readFileSync(process.argv[2], 'utf8'))) })
const db = getFirestore()
const RATE = 300 // ₹ actually paid per entry in the old model

const members = await db.collection('members').get()
let converted = 0
for (const d of members.docs) {
  const m = d.data()
  const credits = m.credits ?? Math.floor((m.balance || 0) / RATE)
  await d.ref.update({
    credits,
    couple: !!m.couple,
    cardPrinted: !!m.cardPrinted,
    cardGiven: !!m.cardGiven,
    cardUid: m.cardUid || null,
    balance: FieldValue.delete(),
    reserved: FieldValue.delete(),
    position: FieldValue.delete(),
    level: FieldValue.delete(),
    walletOwnerId: FieldValue.delete(),
    partnerId: FieldValue.delete(),
    info: FieldValue.delete(),
  })
  converted++
  if (m.balance) console.log(`  ${m.name}: ₹${m.balance} → ${credits} credits`)
}
console.log(`✓ ${converted} members converted to credits`)

const sessions = await db.collection('sessions').get()
for (const d of sessions.docs) {
  const s = d.data()
  const patch = {}
  if (!s.startedAt && s.createdAt) patch.startedAt = s.createdAt
  if (s.status === 'active') { patch.status = 'ended'; patch.endedAt = FieldValue.serverTimestamp() }
  if (Object.keys(patch).length) await d.ref.update(patch)
}
console.log(`✓ ${sessions.size} sessions normalised (any active one ended)`)
console.log('Migration complete — deploy the new build now.')
process.exit(0)
