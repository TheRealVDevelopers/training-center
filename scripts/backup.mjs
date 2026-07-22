// Full safety backup: every Firestore collection + all auth users → local JSON.
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { initializeApp, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
initializeApp({ credential: cert(JSON.parse(readFileSync(process.argv[2],'utf8'))) })
const db = getFirestore()
const stamp = new Date().toISOString().replace(/[:.]/g,'-').slice(0,19)
const dir = `backups/${stamp}`
mkdirSync(dir, { recursive: true })
const collections = await db.listCollections()
for (const col of collections) {
  const snap = await col.get()
  const rows = snap.docs.map(d => ({ _id: d.id, ...d.data() }))
  writeFileSync(`${dir}/${col.id}.json`, JSON.stringify(rows, null, 1))
  console.log(`✓ ${col.id}: ${rows.length} docs`)
}
let users = [], token
do {
  const page = await getAuth().listUsers(1000, token)
  users.push(...page.users.map(u => ({ uid: u.uid, email: u.email, displayName: u.displayName, created: u.metadata.creationTime })))
  token = page.pageToken
} while (token)
writeFileSync(`${dir}/_authUsers.json`, JSON.stringify(users, null, 1))
console.log(`✓ auth users: ${users.length}`)
console.log(`Backup complete → ${dir}`)
process.exit(0)
