// Import a Google-Form signup export into members + logins.
//
// The form was handed out at the club when people couldn't sign up themselves,
// so it contains: duplicate submissions, people who ALREADY have an account,
// and a few malformed emails. This script sorts all of that out and only
// creates what is genuinely missing.
//
// Matching an existing member: by email OR by phone number (people often typed
// a different email than the one they registered with).
//
// Usage:
//   node scripts/import-form.mjs <serviceAccount.json> <form.csv> [password] [--apply]
//   (dry run by default — prints the full plan and changes nothing)

import { readFileSync } from 'fs'
import { initializeApp, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { randomUUID } from 'crypto'
import { resolveTier } from '../src/config.js'

const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const [keyPath, csvPath] = args.filter((a) => !a.startsWith('--'))
const PASSWORD = args.filter((a) => !a.startsWith('--'))[2] || '123456'
if (!keyPath || !csvPath) {
  console.error('Usage: node scripts/import-form.mjs <serviceAccount.json> <form.csv> [password] [--apply]')
  process.exit(1)
}

initializeApp({ credential: cert(JSON.parse(readFileSync(keyPath, 'utf8'))) })
const auth = getAuth()
const db = getFirestore()

function parseCsv(text) {
  const rows = []
  let row = [], field = '', inQ = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQ) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++ }
      else if (c === '"') inQ = false
      else field += c
    } else if (c === '"') inQ = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n' || c === '\r') {
      if (field !== '' || row.length) { row.push(field); rows.push(row); row = []; field = '' }
      if (c === '\r' && text[i + 1] === '\n') i++
    } else field += c
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row) }
  return rows
}

const cleanEmail = (s) => (s || '').trim().toLowerCase().replace(/\s+/g, '')
const digits = (s) => (s || '').replace(/\D/g, '')
const phoneKey = (s) => { const d = digits(s); return d.length > 10 ? d.slice(-10) : d }
const validEmail = (e) => /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(e)

// Google Form headings → our fields.
const raw = parseCsv(readFileSync(csvPath, 'utf8')).filter((r) => r.some((c) => c.trim() !== ''))
const head = raw[0].map((h) => h.trim().toLowerCase())
const find = (...names) => head.findIndex((h) => names.some((n) => h.includes(n)))
const cName = find('full name', 'name')
const cClub = find('club')
const cCouple = find('couple')
const cPhone = find('phone', 'mobile')
const cEmail = find('email')
const cTier = find('team', 'affiliation', 'tier')

const rows = raw.slice(1)
  .map((r, i) => ({
    line: i + 2,
    name: (r[cName] || '').trim().replace(/\s+/g, ' '),
    clubName: (r[cClub] || '').trim().replace(/\s+/g, ' '),
    couple: /yes/i.test(r[cCouple] || ''),
    mobile: digits(r[cPhone] || ''),
    email: cleanEmail(r[cEmail] || ''),
    tierRaw: (r[cTier] || '').trim(),
  }))
  .filter((r) => r.name || r.email)

// GET Team-1000 → 'GET TEAM', GET Team-2500 → 'GET 2500', President's → Presidents
function tierOf(raw) {
  const s = (raw || '').toLowerCase()
  if (s.includes('2500')) return 'GET 2500'
  if (s.includes('get')) return 'GET TEAM'
  if (s.includes('7500')) return 'Millionaire 7500'
  if (s.includes('million') || s.includes('4000')) return 'Millionaire 4000'
  if (s.includes('president')) return 'Presidents Team'
  if (s.includes('world')) return 'World Team'
  if (s.includes('supervis')) return 'Supervisor'
  return resolveTier(raw)
}

// ---- 1. de-duplicate WITHIN the form (people submitted 2-3 times) ----------
const byKey = new Map()
const dupes = []
for (const r of rows) {
  const key = validEmail(r.email) ? r.email : `phone:${phoneKey(r.mobile)}`
  if (!key || key === 'phone:') continue
  const prev = byKey.get(key)
  if (prev) {
    // keep the LAST submission (they corrected themselves), but never lose a
    // longer name like "Balakrishna & Suma" over "Balakrishna. B"
    dupes.push({ kept: r.line, dropped: prev.line, key })
    byKey.set(key, { ...r, name: r.name.length >= prev.name.length ? r.name : prev.name })
  } else byKey.set(key, r)
}
// Second pass: someone who typed a broken email and then re-submitted with a
// good one appears twice (same phone, same name). Drop the broken one — but
// only when the names match, so two family members sharing a phone stay apart.
let merged = [...byKey.values()]
const sameName = (a, b) => {
  const n = (s) => s.toLowerCase().replace(/[^a-z]/g, '')
  return n(a) && (n(a) === n(b) || n(a).startsWith(n(b)) || n(b).startsWith(n(a)))
}
merged = merged.filter((r) => {
  if (validEmail(r.email)) return true
  const better = merged.find(
    (o) => o !== r && validEmail(o.email) && phoneKey(o.mobile) === phoneKey(r.mobile) && sameName(o.name, r.name),
  )
  if (better) { dupes.push({ kept: better.line, dropped: r.line, key: `phone ${r.mobile} (bad email)` }); return false }
  return true
})
const unique = merged

// ---- 2. compare with what's already in the database ------------------------
const snap = await db.collection('members').get()
const existing = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
const byEmail = new Map(existing.filter((m) => m.email).map((m) => [cleanEmail(m.email), m]))
const byPhone = new Map(existing.filter((m) => m.mobile).map((m) => [phoneKey(m.mobile), m]))

const already = [], toCreate = [], badEmail = []
for (const r of unique) {
  const hit = (validEmail(r.email) && byEmail.get(r.email)) || (phoneKey(r.mobile) && byPhone.get(phoneKey(r.mobile)))
  if (hit) { already.push({ r, hit }); continue }
  if (!validEmail(r.email)) { badEmail.push(r); continue }   // no login possible
  toCreate.push(r)
}

// ---- report ----------------------------------------------------------------
console.log(APPLY ? '=== APPLYING ===\n' : '=== DRY RUN (add --apply to write) ===\n')
console.log(`form rows: ${rows.length} · unique people: ${unique.length} · duplicate submissions dropped: ${dupes.length}`)
dupes.forEach((d) => console.log(`   dup: line ${d.dropped} superseded by ${d.kept}  (${d.key})`))

console.log(`\nALREADY REGISTERED — skipping (${already.length}):`)
already.forEach(({ r, hit }) => console.log(`   ${r.name}  →  matches "${hit.name}" (${hit.email || hit.mobile})`))

console.log(`\nNO USABLE EMAIL — will create profile WITHOUT login (${badEmail.length}):`)
badEmail.forEach((r) => console.log(`   ${r.name}  (${r.email || 'blank'})  ${r.mobile}`))

console.log(`\nNEW — create login + profile (${toCreate.length}):`)
toCreate.forEach((r) => console.log(`   ${r.name.padEnd(28)} ${r.email.padEnd(38)} ${tierOf(r.tierRaw).padEnd(18)}${r.couple ? '👫' : ''}`))

// Things that will still work but a human should eyeball afterwards.
const suspect = [...toCreate, ...badEmail].filter((r) =>
  phoneKey(r.mobile).length !== 10 || /@\d|\s/.test(r.email) || !r.clubName)
if (suspect.length) {
  console.log(`\n⚠ CHECK THESE AFTER IMPORT (${suspect.length}) — imported, but the data looks off:`)
  suspect.forEach((r) => console.log(
    `   ${r.name.padEnd(28)} ${(r.email || '(no email)').padEnd(38)} phone ${r.mobile || '—'}${r.clubName ? '' : ' · no club'}`,
  ))
}

if (!APPLY) {
  console.log(`\nNothing written. Re-run with --apply to create ${toCreate.length} logins + ${badEmail.length} no-login profiles.`)
  process.exit(0)
}

// ---- apply -----------------------------------------------------------------
let made = 0, linked = 0
for (const r of toCreate) {
  let uid
  try {
    const u = await auth.createUser({ email: r.email, password: PASSWORD, displayName: r.name })
    uid = u.uid
  } catch (e) {
    if (e.code === 'auth/email-already-exists') {
      const u = await auth.getUserByEmail(r.email)
      uid = u.uid
      await auth.updateUser(uid, { password: PASSWORD })
      linked++
    } else { console.log(`   ! ${r.name}: ${e.message}`); continue }
  }
  const ref = db.collection('members').doc(uid)
  const exists = (await ref.get()).exists
  if (!exists) {
    await ref.set({
      name: r.name, mobile: r.mobile, email: r.email,
      tier: tierOf(r.tierRaw), clubName: r.clubName, city: '', years: '',
      photoURL: '', credits: 0, couple: r.couple,
      cardUid: null, cardUids: [], memberToken: randomUUID().replace(/-/g, ''),
      cardPrinted: false, printedCount: 0, cardGiven: false, givenCount: 0,
      role: 'member', source: 'google-form', createdAt: FieldValue.serverTimestamp(),
    })
    made++
  }
}
for (const r of badEmail) {
  const ref = db.collection('members').doc()
  await ref.set({
    name: r.name, mobile: r.mobile, email: '',
    tier: tierOf(r.tierRaw), clubName: r.clubName, city: '', years: '',
    photoURL: '', credits: 0, couple: r.couple,
    cardUid: null, cardUids: [], memberToken: randomUUID().replace(/-/g, ''),
    cardPrinted: false, printedCount: 0, cardGiven: false, givenCount: 0,
    role: 'member', noLogin: true, source: 'google-form', createdAt: FieldValue.serverTimestamp(),
  })
  made++
}
console.log(`\n✓ ${made} member(s) created · ${linked} existing login(s) had their password reset to "${PASSWORD}"`)
process.exit(0)
