// Bulk member import — creates login accounts + member profiles from a CSV.
//
// Safe to re-run. For each row:
//   • Auth: create the user if the email is new; if it already exists, reset
//     their password to the shared one. (Passwords only — never touches money.)
//   • Firestore members/{uid}: create the profile if missing; if it exists,
//     fill in any provided fields WITHOUT overwriting balance, reserved,
//     memberToken, or createdAt.
//
// Usage:
//   npm i firebase-admin            # one-time (dev dependency)
//   node scripts/import-members.mjs <serviceAccount.json> <members.csv> [password]
//
// CSV header (first line), columns in any order, extras ignored:
//   name,email,mobile,clubName,position,years,city
//
// Example row:
//   Ramesh K,rameshakc@gmail.com,9945000000,Magic Club,GET,5,Bengaluru

import { readFileSync } from 'fs'
import { initializeApp, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { randomUUID } from 'crypto'

const [, , keyPath, csvPath, passwordArg] = process.argv
if (!keyPath || !csvPath) {
  console.error('Usage: node scripts/import-members.mjs <serviceAccount.json> <members.csv> [password]')
  process.exit(1)
}
const PASSWORD = passwordArg || '123456'

const serviceAccount = JSON.parse(readFileSync(keyPath, 'utf8'))
initializeApp({ credential: cert(serviceAccount) })
const auth = getAuth()
const db = getFirestore()

// Minimal CSV parser (handles quoted fields + commas inside quotes).
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

const raw = parseCsv(readFileSync(csvPath, 'utf8')).filter((r) => r.some((c) => c.trim() !== ''))
const header = raw[0].map((h) => h.trim().toLowerCase())
const idx = (name) => header.indexOf(name)
const col = { name: idx('name'), email: idx('email'), mobile: idx('mobile'), clubName: idx('clubname'), position: idx('position'), years: idx('years'), city: idx('city') }
if (col.email < 0 || col.name < 0) { console.error('CSV must have at least "name" and "email" columns.'); process.exit(1) }

const people = raw.slice(1).map((r) => ({
  name: (r[col.name] || '').trim(),
  email: (r[col.email] || '').trim().toLowerCase(),
  mobile: col.mobile >= 0 ? (r[col.mobile] || '').trim() : '',
  clubName: col.clubName >= 0 ? (r[col.clubName] || '').trim() : '',
  position: col.position >= 0 ? (r[col.position] || '').trim() : '',
  years: col.years >= 0 ? (r[col.years] || '').trim() : '',
  city: col.city >= 0 ? (r[col.city] || '').trim() : '',
})).filter((p) => p.email)

console.log(`Importing ${people.length} people. Password for all: "${PASSWORD}"\n`)
let created = 0, updated = 0, failed = 0

for (const p of people) {
  try {
    // 1) Auth: create or reset password.
    let uid
    try {
      const u = await auth.getUserByEmail(p.email)
      uid = u.uid
      await auth.updateUser(uid, { password: PASSWORD, displayName: p.name || u.displayName || undefined })
      process.stdout.write(`~ reset  ${p.email}`)
    } catch (e) {
      if (e.code === 'auth/user-not-found') {
        const u = await auth.createUser({ email: p.email, password: PASSWORD, displayName: p.name || undefined })
        uid = u.uid
        process.stdout.write(`+ create ${p.email}`)
      } else throw e
    }

    // 2) Firestore profile: create if missing; else fill provided fields only,
    //    never overwriting money / token / createdAt.
    const ref = db.collection('members').doc(uid)
    const snap = await ref.get()
    if (!snap.exists) {
      await ref.set({
        name: p.name, mobile: p.mobile, email: p.email,
        position: p.position, clubName: p.clubName, years: p.years, city: p.city,
        info: '', photoURL: '',
        balance: 0, reserved: 0,
        memberToken: randomUUID().replace(/-/g, ''),
        role: 'member',
        createdAt: FieldValue.serverTimestamp(),
      })
      created++; console.log('  → profile created')
    } else {
      const cur = snap.data()
      const patch = {}
      for (const k of ['name', 'mobile', 'position', 'clubName', 'years', 'city']) {
        if (p[k] && !cur[k]) patch[k] = p[k] // only fill blanks; don't clobber
      }
      if (!cur.memberToken) patch.memberToken = randomUUID().replace(/-/g, '')
      if (Object.keys(patch).length) await ref.update(patch)
      updated++; console.log('  → profile ' + (Object.keys(patch).length ? 'updated' : 'ok'))
    }
  } catch (e) {
    failed++; console.log(`\n! FAILED ${p.email}: ${e.message}`)
  }
}

console.log(`\nDone. profiles created: ${created}, existing updated/ok: ${updated}, failed: ${failed}`)
process.exit(0)
