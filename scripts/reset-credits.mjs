// Clean slate before relaunch: every member's credits → 0.
// The wipe is written into the ledger as an 'adjust' row per member, so the
// money history still explains itself later (nothing silently disappears).
// Usage: node scripts/reset-credits.mjs <serviceAccount.json> [--apply]
import { readFileSync } from 'fs'
import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'

const APPLY = process.argv.includes('--apply')
initializeApp({ credential: cert(JSON.parse(readFileSync(process.argv[2], 'utf8'))) })
const db = getFirestore()

const snap = await db.collection('members').get()
const withCredits = snap.docs.filter((d) => (d.data().credits || 0) !== 0)
console.log(APPLY ? '=== APPLYING ===' : '=== DRY RUN (add --apply) ===')
console.log(`${snap.size} members · ${withCredits.length} hold credits right now`)
withCredits.forEach((d) => console.log(`   ${d.data().name}: ${d.data().credits} → 0`))

if (!APPLY) { console.log('\nNothing written.'); process.exit(0) }
for (const d of withCredits) {
  const m = d.data()
  await d.ref.update({ credits: 0 })
  await db.collection('transactions').add({
    memberId: d.id,
    memberName: m.name || '',
    type: 'adjust',
    credits: -(m.credits || 0),
    amount: 0,
    note: 'Reset to 0 · fresh start, credits re-issued on proof of payment',
    by: { kind: 'owner', label: 'reset script' },
    createdAt: FieldValue.serverTimestamp(),
  })
}
console.log(`\n✓ ${withCredits.length} member(s) reset to 0 credits (each logged in the ledger)`)
process.exit(0)
