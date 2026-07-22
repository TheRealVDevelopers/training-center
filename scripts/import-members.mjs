// Bulk member import — creates login accounts + member profiles from a CSV,
// with tier pricing and couple (shared-wallet) linking.
//
// Safe to re-run. For each row:
//   • Auth: create the user if the email is new; if it already exists, reset
//     their password to the shared one. (Passwords only — never touches money.)
//   • Firestore members/{uid}: create the profile if missing; if it exists,
//     fill blank fields WITHOUT overwriting balance, memberToken, or createdAt.
//   • Couples: rows with a partnerEmail are linked into ONE shared wallet
//     (deterministic owner), each showing the other as partner.
//
// Usage:
//   npm i firebase-admin            # one-time
//   node scripts/import-members.mjs <serviceAccount.json> <members.csv> [password]
//
// CSV header (columns in any order, extras ignored):
//   name,email,mobile,clubName,tier,years,city,partnerEmail
//
// tier must match a level in src/config.js TIERS (case/space-insensitive),
// e.g. "GET TEAM", "Millionaire 4000", "Presidents Team". Blank → default.

import { readFileSync } from 'fs'
import { initializeApp, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { randomUUID } from 'crypto'
import { resolveTier } from '../src/config.js'

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
const col = { name: idx('name'), email: idx('email'), mobile: idx('mobile'), clubName: idx('clubname'), tier: idx('tier'), years: idx('years'), city: idx('city'), partnerEmail: idx('partneremail'), couple: idx('couple') }
if (col.email < 0 || col.name < 0) { console.error('CSV must have at least "name" and "email" columns.'); process.exit(1) }

const get = (r, i) => (i >= 0 ? (r[i] || '').trim() : '')
const people = raw.slice(1).map((r) => ({
  name: get(r, col.name),
  email: get(r, col.email).toLowerCase(),
  mobile: get(r, col.mobile),
  clubName: get(r, col.clubName),
  tier: resolveTier(get(r, col.tier)),
  years: get(r, col.years),
  city: get(r, col.city),
  partnerEmail: get(r, col.partnerEmail).toLowerCase(),
  couple: /^(y|yes|true|1|couple)$/i.test(get(r, col.couple)),
})).filter((p) => p.email)

console.log(`Importing ${people.length} people. Password for all: "${PASSWORD}"\n`)
let created = 0, updated = 0, failed = 0
const emailToUid = {}

for (const p of people) {
  try {
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
    emailToUid[p.email] = uid

    const ref = db.collection('members').doc(uid)
    const snap = await ref.get()
    if (!snap.exists) {
      await ref.set({
        name: p.name, mobile: p.mobile, email: p.email,
        position: '', clubName: p.clubName, tier: p.tier,
        years: p.years, city: p.city, info: '', photoURL: '',
        balance: 0, reserved: 0,
        walletOwnerId: uid, partnerId: null,
        couple: p.couple, cardPrinted: false, cardGiven: false,
        memberToken: randomUUID().replace(/-/g, ''),
        role: 'member',
        createdAt: FieldValue.serverTimestamp(),
      })
      created++; console.log('  → profile created')
    } else {
      const cur = snap.data()
      const patch = {}
      for (const k of ['name', 'mobile', 'clubName', 'tier', 'years', 'city']) {
        if (p[k] && !cur[k]) patch[k] = p[k] // fill blanks only; never clobber
      }
      if (!cur.memberToken) patch.memberToken = randomUUID().replace(/-/g, '')
      if (!cur.walletOwnerId) patch.walletOwnerId = uid
      if (p.couple && !cur.couple) patch.couple = true // explicit couple flag
      if (Object.keys(patch).length) await ref.update(patch)
      updated++; console.log('  → profile ' + (Object.keys(patch).length ? 'updated' : 'ok'))
    }
  } catch (e) {
    failed++; console.log(`\n! FAILED ${p.email}: ${e.message}`)
  }
}

// ---- Couples: link partners into one shared wallet ------------------------
console.log('\nLinking couples…')
let couples = 0
const seen = new Set()
for (const p of people) {
  if (!p.partnerEmail) continue
  const aUid = emailToUid[p.email]
  const bUid = emailToUid[p.partnerEmail]
  if (!aUid || !bUid || aUid === bUid) { console.log(`  ! skip couple ${p.email} ↔ ${p.partnerEmail} (missing account)`); continue }
  const key = [p.email, p.partnerEmail].sort().join('|')
  if (seen.has(key)) continue
  seen.add(key)
  // Deterministic owner: the alphabetically-smaller email holds the wallet.
  const [ownerUid, otherUid] = p.email < p.partnerEmail ? [aUid, bUid] : [bUid, aUid]
  try {
    const oRef = db.collection('members').doc(ownerUid)
    const xRef = db.collection('members').doc(otherUid)
    const [oSnap, xSnap] = await Promise.all([oRef.get(), xRef.get()])
    const oBal = oSnap.data()?.balance || 0
    const xBal = xSnap.data()?.balance || 0
    await oRef.update({ walletOwnerId: ownerUid, partnerId: otherUid, balance: oBal + xBal })
    await xRef.update({ walletOwnerId: ownerUid, partnerId: ownerUid, balance: 0 })
    couples++; console.log(`  ♥ linked ${p.email} ↔ ${p.partnerEmail}`)
  } catch (e) {
    console.log(`  ! couple failed ${key}: ${e.message}`)
  }
}

console.log(`\nDone. profiles created: ${created}, existing updated/ok: ${updated}, couples linked: ${couples}, failed: ${failed}`)
process.exit(0)
