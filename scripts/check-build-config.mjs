#!/usr/bin/env node
/**
 * Deploy guard — runs as a Firebase `predeploy` hook, before anything ships.
 *
 * Vite bakes VITE_FIREBASE_* into the bundle at BUILD time. So a build made
 * with a missing, half-filled or placeholder .env produces a site that looks
 * perfectly fine on disk and points at a Firebase project that does not exist.
 * Deploy that and every member, receptionist and owner hits a dead app.
 *
 * Nothing about the deploy itself catches this: the CLI only uploads files.
 * This does. It reads the bundle that is about to ship and refuses if the
 * config in it is not the real config for the project being deployed to.
 *
 * Run manually any time:  node scripts/check-build-config.mjs
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const DIST = 'dist'
const fail = (msg, fix) => {
  console.error(`\n✗ Deploy blocked: ${msg}\n`)
  if (fix) console.error(`  ${fix}\n`)
  process.exit(1)
}

// The project actually being deployed to. The Firebase CLI exports these to
// predeploy hooks, so `--project staging` is respected; .firebaserc is the
// fallback for a plain `firebase deploy` or a manual run.
function targetProject() {
  const fromCli = process.env.GCLOUD_PROJECT || process.env.PROJECT_ID
  if (fromCli) return fromCli
  try {
    return JSON.parse(readFileSync('.firebaserc', 'utf8'))?.projects?.default || null
  } catch {
    return null
  }
}

if (!existsSync(DIST) || !existsSync(join(DIST, 'index.html'))) {
  fail(`no build found in ${DIST}/.`, 'Run: npm run build')
}

const assets = join(DIST, 'assets')
const js = (existsSync(assets) ? readdirSync(assets) : [])
  .filter((f) => f.endsWith('.js'))
  .map((f) => readFileSync(join(assets, f), 'utf8'))
  .join('\n')

if (!js) fail(`no JavaScript in ${DIST}/assets/ — the build looks incomplete.`, 'Run: npm run build')

// 1) Known-fake values. Deliberately narrow: the bare word "placeholder" is a
//    legitimate input attribute all over the app, so only match strings that
//    could not appear except as dummy Firebase config.
const FAKES = [
  'AIzaSyDUMMY',
  'placeholder.firebaseapp.com',
  'placeholder.appspot.com',
  'your-api-key',
  'YOUR_API_KEY',
  'xxxxxxxx',
]
const found = FAKES.filter((f) => js.includes(f))
if (found.length) {
  fail(
    `the build contains placeholder Firebase config (${found.join(', ')}).`,
    'Put the real values in .env, then rebuild: npm run build',
  )
}

// 2) The real config must actually be in there. This is the check that catches
//    a missing .env, where Vite inlines `undefined` and there is no marker to
//    grep for — and it catches building against one project then deploying to
//    another, which is the quiet way to wreck a weekend.
const project = targetProject()
if (!project) {
  fail('cannot tell which Firebase project is being deployed to.', 'Check .firebaserc, or pass --project <id>.')
}
if (!js.includes(project)) {
  fail(
    `the build does not carry the config for "${project}".\n` +
      '  Either .env was not loaded when it was built, or it was built for a different project.',
    `Confirm VITE_FIREBASE_PROJECT_ID=${project} in .env, then rebuild: npm run build`,
  )
}

// 3) An API key of the right shape must be present. Guards the case where the
//    project id is right but a key is blank or truncated.
if (!/AIza[0-9A-Za-z_-]{35}/.test(js)) {
  fail(
    'no valid-looking Firebase API key in the build (expected an AIza… key).',
    'Check VITE_FIREBASE_API_KEY in .env, then rebuild: npm run build',
  )
}

console.log(`✓ Build config checked — real Firebase config for "${project}". Deploying.`)
