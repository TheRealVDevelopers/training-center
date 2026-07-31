// ONE-OFF: normalise sessions to one-per-day, date-keyed.
//
// Before: sessions had random IDs and duplicated (three docs for 18 Jul), so
// "who attended that Saturday" had no single answer and month totals
// multi-counted.
// After:  sessions/YYYY-MM-DD — one per day, entries re-pointed, duplicates
// gone, every session stamped with `date`.
//
// Safe to re-run. RUN backup.mjs FIRST — deletions are irreversible.
//
// Usage: node scripts/merge-sessions.mjs <serviceAccount.json> [--apply]
//        (without --apply it only prints the plan — dry run by default)

import { readFileSync } from 'fs'
import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const APPLY = process.argv.includes('--apply')
initializeApp({ credential: cert(JSON.parse(readFileSync(process.argv[2], 'utf8'))) })
const db = getFirestore()

const pad = (n) => String(n).padStart(2, '0')
const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const tsOf = (s) => s.startedAt || s.createdAt || null

console.log(APPLY ? '=== APPLYING ===' : '=== DRY RUN (add --apply to write) ===\n')

// 1. Group every existing session by its local date.
const sessions = await db.collection('sessions').get()
const byDay = new Map()
for (const d of sessions.docs) {
  const s = d.data()
  const ts = tsOf(s)
  if (!ts) { console.log(`  ! ${d.id} has no timestamp — skipped`); continue }
  const key = s.date || dayKey(ts.toDate())
  if (!byDay.has(key)) byDay.set(key, [])
  byDay.get(key).push({ id: d.id, ref: d.ref, data: s, ts })
}

// 2. For each day: the canonical doc is sessions/<date>. Re-point that day's
//    entries to it, then delete the old docs.
const entries = await db.collection('entries').get()
const entriesBySession = new Map()
for (const e of entries.docs) {
  const sid = e.data().sessionId
  if (!entriesBySession.has(sid)) entriesBySession.set(sid, [])
  entriesBySession.get(sid).push(e)
}

let moved = 0, deleted = 0, created = 0
for (const [date, group] of [...byDay.entries()].sort()) {
  group.sort((a, b) => a.ts.seconds - b.ts.seconds)
  const first = group[0]
  const dupes = group.filter((g) => g.id !== date)
  const ended = group.every((g) => g.data.status !== 'active')

  console.log(`${date}  ${group.length} doc(s)${group.length > 1 ? '  ← DUPLICATES' : ''}`)

  const canonical = {
    date,
    status: ended ? 'ended' : 'active',
    startedAt: first.data.startedAt || first.data.createdAt,
    endedAt: group[group.length - 1].data.endedAt || null,
  }

  if (APPLY) {
    await db.collection('sessions').doc(date).set(canonical, { merge: true })
    created++
  }

  // Re-point entries: IDs are `${sessionId}_${memberId}`, so a moved entry is
  // written under the new deterministic ID and the old doc removed.
  for (const g of group) {
    for (const e of entriesBySession.get(g.id) || []) {
      const data = e.data()
      const newId = `${date}_${data.memberId}`
      console.log(`    entry ${data.name || data.memberId}: ${g.id} → ${date}`)
      if (APPLY) {
        await db.collection('entries').doc(newId).set(
          { ...data, sessionId: date, sessionDate: date },
          { merge: true },
        )
        if (e.id !== newId) await e.ref.delete()
      }
      moved++
    }
  }

  for (const g of dupes) {
    console.log(`    delete old session doc ${g.id}`)
    if (APPLY) await g.ref.delete()
    deleted++
  }
}

// 3. Transactions carry sessionId too — keep them pointing at real sessions.
const txns = await db.collection('transactions').get()
let txFixed = 0
for (const t of txns.docs) {
  const sid = t.data().sessionId
  if (!sid) continue
  const owner = [...byDay.entries()].find(([, g]) => g.some((x) => x.id === sid))
  if (owner && owner[0] !== sid) {
    console.log(`    txn ${t.id}: session ${sid} → ${owner[0]}`)
    if (APPLY) await t.ref.update({ sessionId: owner[0], sessionDate: owner[0] })
    txFixed++
  }
}

console.log(`\n${APPLY ? '✓ done' : 'would'}: ${created} session(s) normalised · ` +
  `${moved} entry re-point(s) · ${deleted} duplicate(s) removed · ${txFixed} txn(s) fixed`)
if (!APPLY) console.log('\nRe-run with --apply to write these changes.')
process.exit(0)
