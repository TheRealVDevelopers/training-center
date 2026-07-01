# Saturday Training — Registration (V1 prototype)

React + Firebase prototype. Members create an account, book a slot (for self,
self+guest, or guest-only), and get a QR. At the door, volunteers open a
scanner-only page on their phones, scan the QR, and the member is checked in —
the fee is deducted **at scan**, and a live counter updates on the admin
dashboard in real time. No physical scanners needed: the phone camera is the
scanner.

## What's in it
- **Member**: signup (name, mobile, email, password, photo) → dashboard with
  balance + 3 booking buttons → QR per booking (cancellable until scanned) →
  history.
- **Scanner** (`/scan?gate=1`): open page, phone camera, tick + name + people
  count, auto-resumes. Open it on as many phones/gates as you want.
- **Admin** (`/admin`): registered members, live attendees, remaining seats, and
  a real-time entry feed with faces. `/admin/credits` adds balance (with payment
  method + reference captured).

## Correctness notes (already built in)
- **No double check-in.** Check-in is a Firestore transaction; only the first
  scan of a booking wins. A second scan at any gate shows "Already entered" and
  never deducts twice — so the live count stays right across multiple phones.
- **QR = a random booking token**, not a member id, so codes aren't guessable.
- **Money is a ledger.** Every top-up and deduction is a row in `transactions`;
  balance changes never happen silently.

## Setup (one time)

1. **Create a Firebase project** at https://console.firebase.google.com
2. In the project, enable:
   - **Authentication** → Sign-in method → **Email/Password** → Enable
   - **Firestore Database** → Create database (start in test mode is fine for the prototype)
   - **Storage** → Get started (for member/guest photos)
3. **Add a Web app** (Project settings → General → Your apps → `</>`). Copy the
   config values.
4. In this folder, copy `.env.example` to `.env` and paste the values:
   ```
   VITE_FIREBASE_API_KEY=...
   VITE_FIREBASE_AUTH_DOMAIN=...
   VITE_FIREBASE_PROJECT_ID=...
   VITE_FIREBASE_STORAGE_BUCKET=...
   VITE_FIREBASE_MESSAGING_SENDER_ID=...
   VITE_FIREBASE_APP_ID=...
   ```
5. (Optional) Paste `firestore.rules` into Firestore → Rules. They're wide-open
   for the prototype — see the warning in that file before any real launch.
6. Set the admin email in `src/config.js` (`ADMIN_EMAILS`) — currently your
   email. Also tune `feePerPerson` and `capacity` there.

## Run

```bash
npm install
npm run dev
```

- Open `http://localhost:5173` on your laptop → sign up → that account, if its
  email is in `ADMIN_EMAILS`, can open `/admin` and press **Start session**.
- Add balance to a member from **Admin → Credits**.
- Book a slot as a member to get a QR.

### Testing the multi-phone door
The dev server runs with `--host`, so phones on the **same wifi** can open the
scanner. Find your laptop's LAN IP (`ipconfig` on Windows) and on each phone open:
```
http://<laptop-ip>:5173/scan?gate=1   (gate=2, 3, 4 on the others)
```
> 📷 Phone cameras need a **secure context**. `localhost` works on the laptop,
> but phones hitting `http://<ip>` may block the camera. Easiest fix for a demo:
> run it through a tunnel (e.g. `npx cloudflared tunnel --url http://localhost:5173`)
> and open the HTTPS URL on the phones. For real deployment, host it on any
> HTTPS host (Firebase Hosting, Vercel, Netlify — all free tier).

## Deploy to HTTPS (so real phones can scan)

The phone-camera scanner needs HTTPS. Firebase Hosting gives you a free HTTPS URL
and is already configured (`firebase.json`):

```bash
npm install -g firebase-tools   # once
firebase login                  # once
firebase use --add              # pick your Firebase project
npm run build
firebase deploy                 # deploys hosting + firestore.rules
```

You'll get a URL like `https://<project>.web.app`. Open `…/scan?gate=1` (gate=2,
3, 4) on each volunteer's phone and the camera will work — no tunnel needed.

## Notes / known prototype shortcuts
- Funds are **held at booking** and **deducted at check-in** (released if you
  cancel), so a member can't book more slots than their available balance covers.
  Member dashboard shows "available to book" = wallet balance − held.
- `/scan` is unauthenticated for volunteer convenience — fine for a prototype,
  must be gated before production (see `firestore.rules`).
- One active session at a time (`status: 'active'`). "Start session" creates it.

> ⚠️ This folder is under OneDrive. `node_modules` is gitignored, but OneDrive
> may still try to sync it and slow things down — consider pausing OneDrive sync
> while developing, or moving the project outside the OneDrive folder.
