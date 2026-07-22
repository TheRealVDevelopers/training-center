# Saturday Training — Tap. Green. In.

React + Firebase walk-in system for a Herbalife nutrition club. Every member
carries one permanent pass (NFC tap card and/or phone QR). On Saturday they
just walk in and tap: **green** = entered (−1 credit), **red** = no credits →
recharge at the desk, tap again, in.

## The three surfaces

| URL | Who | What |
|---|---|---|
| `/admin` | Receptionist (staff PIN, typed once per device) | THE staff screen: live tap feed with instant green/red, one-tap **Recharge** on red rows, **+ Guest** on green rows, In/Out switch, Find-member (check-in · recharge · assign first card). Session auto-starts on the first tap. |
| `/owner` | Owner (email login) | One page, four tabs — **Today** (live numbers, who entered, past Saturdays, staff PIN), **People** (level = price + card design, couple ×2, credits, card printed/given, add member without email, replace card, password reset), **Money** (every payment by day, cash vs UPI, delete-a-mistake), **Print** (Card Studio + printer test). |
| `/` | Member | Their card: credits left, **Show my pass** (QR), history. `/profile` for photo/details/password. |

Public: `/door` shows a big QR → `/feed`, a watch-only live board for anyone
at the door. No code, no buttons, no money shown.

## The money model — credits

- Wallet holds **whole credits**. 1 credit = 1 entry, for everyone.
- Credits sell **only in packs of 5**; the ₹ price of a pack comes from the
  member's level (`src/config.js` → `TIERS`): ₹300 (Associate/Supervisor/World
  Team), ₹1000 (GET), ₹1500 (Millionaire), ₹2000 (Presidents Team).
- Every recharge / entry / correction is an append-only row in `transactions`.
- **Couple** = one account flagged ×2 → two printed cards, same wallet; both
  spouses enter on the session's single entry (never charged twice).
- One entry doc per member per session (`entries/{sessionId_memberId}`) makes
  double-charging impossible from any device.

## Why taps feel instant

The reception device keeps a live copy of the member list. A tap's verdict
(green/red) is decided **locally in ~150 ms** — light, sound, row on the board
— while the cloud transaction confirms in the background. Offline, entries
queue and sync when wifi returns; money actions always wait for the network.

## Hardware

Readers all feed the reception screen: USB PC/SC readers via the local bridge
(`card-bridge/`), keyboard-wedge QR guns (hidden always-focused catcher), and
phone QR passes. Card printing: Card Studio (`/admin/print`) on an Evolis-type
CR80 printer; run Chrome with `--kiosk-printing` to skip dialogs.

## Setup

1. Firebase project with **Auth** (Email/Password **and Anonymous**),
   **Firestore**, **Storage**, **Hosting**.
2. `.env` from `.env.example` (`VITE_FIREBASE_*`).
3. Owner email in `src/config.js` (`SUPER_ADMIN_EMAILS`) **and** in
   `firestore.rules` (`isOwner()`).
4. `npm install && npm run dev` · deploy with
   `npm run build && firebase deploy`.
5. Set the staff PIN from Owner → Today.

## Ops scripts (need a service-account key)

- `scripts/backup.mjs <key>` — full Firestore + auth export to `backups/`.
- `scripts/import-members.mjs <key> <csv> [password]` — bulk create/reset
  members (columns: name,email,mobile,clubName,tier,city,couple).
- `scripts/migrate-credits.mjs <key>` — the one-time ₹→credits cutover
  (already run in production).

## Security model (honest)

No unauthenticated access; members read only their own data and can never
raise credits; ledger deletes are owner-only. Staff devices authenticate
anonymously behind the PIN gate — the PIN is a UX gate, not cryptography; a
determined technical person with the SDK could act as staff. If the club ever
needs bank-grade guarantees, move check-in/recharge into Cloud Functions.
