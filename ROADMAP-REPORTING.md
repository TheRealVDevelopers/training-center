# Saturday Training — Reporting & Member-History Build Guide
**Research + complete build spec · 22 Jul 2026**

This is the plan for everything the app *doesn't* have yet: member profiles with
present/absent history, session reports, month-end reports, retention tracking.
Read Part 0 first — it contains a problem that must be fixed **before** any
report is built, or every report will be wrong.

---

## PART 0 — STATE OF THE DATA TODAY (measured, not guessed)

| Collection | Docs | Meaning |
|---|---|---|
| `members` | 82 | People. Full profile fields present. |
| `entries` | **2** | **Attendance history is essentially EMPTY.** |
| `transactions` | 44 | Money + entry ledger (mostly legacy ₹ rows). |
| `sessions` | 8 | Saturdays. |
| `scanEvents` | 11 | Live-board feed rows (throwaway). |

### 🔴 Finding 1 — History starts NOW, so foundations come first
`entries` has 2 documents. The credits rebuild is new; no real Saturday has run
through it yet. **Every report in this document is powered by `entries`.**

> **Consequence:** whatever is not captured on the day is lost forever. There is
> no way to reconstruct "who attended 18 July" later. So the *foundation* work
> (Part 1, P0) must land **before the next Saturday**, even if the reports
> themselves are built slowly over the following weeks. The reports can be built
> later; the data cannot be collected later.

### 🔴 Finding 2 — Sessions duplicate. This breaks every report.
Actual session dates in the database:

```
2026-06-16   2026-07-01   2026-07-17   2026-07-18 ×3   2026-07-25 (active)
```

**Three separate sessions exist for 18 July.** Cause: `ensureActiveSession()`
creates a new session whenever no *active* one exists. End a session, tap once
more → a second session for the same day. Also 17 July was a Friday (a test).

Why it is fatal for reporting:
- "Attendance on 18 July" = which of the three?
- A member who tapped in session A is **absent** in sessions B and C.
- Month totals double- and triple-count.

**Fix before anything else (F1).** Everything downstream assumes *one session =
one Saturday*.

### 🟢 Finding 3 — The data model is right
`entries` already stores `sessionId, memberId, name, photoURL, couple, guests,
gate, method, at, exitedAt`. That is enough for attendance %, streaks,
punctuality, gate split, guest counts and time-in-room. **No schema redesign is
needed** — the tables exist, the screens don't.

### 🟢 Finding 4 — Scale is tiny; do not over-engineer
82 members × 52 Saturdays ≈ **4,300 entry docs/year**. That is nothing.

> **Rule: compute every report on the client from raw docs. No Cloud Functions,
> no aggregation pipelines, no data warehouse.** Adding them would triple the
> complexity and cost for zero benefit at this size. Revisit only past ~1,000
> members or ~5 years of history.

---

## PART 1 — THE GAP LIST (what's missing, in priority order)

Priority key: **P0** = blocks everything / do before next Saturday ·
**P1** = the features you asked for · **P2** = growth & polish.

| # | Feature | Who needs it | Value | Effort | Pri |
|---|---|---|---|---|---|
| F1 | One session per Saturday (date-keyed, auto-close) | System | 🔴 Critical | S | **P0** |
| F2 | Attendance queryable per member (+ index) | System | 🔴 Critical | S | **P0** |
| F3 | Absence definition + "member since" rule | System | 🔴 Critical | S | **P0** |
| F4 | **Member Profile page** (present/absent per Saturday, money, cards) | Owner | ⭐ Highest | M | **P1** |
| F5 | **Session Report** (per Saturday: came / didn't come / money) | Owner | ⭐ Highest | M | **P1** |
| F6 | **Month-End Report** (attendance %, revenue, retention) | Owner | ⭐ Highest | M | **P1** |
| F7 | **Attendance Matrix** (members × Saturdays grid) | Owner | ⭐ High | M | **P1** |
| F8 | Member sees own history ("you attended 12 of 15") | Member | High | S | **P1** |
| F9 | At-risk list + WhatsApp follow-up | Owner | ⭐ Highest | S | **P1** |
| F10 | CSV / print export of any report | Owner | High | S | P2 |
| F11 | Staff activity log (who recharged what, audit) | Owner | Med-High | S | P2 |
| F12 | Guest tracking → guest-to-member conversion | Owner | Medium | M | P2 |
| F13 | Low-credit & renewal reminder list | Reception | High | S | P2 |
| F14 | Milestones (10th/50th visit, join anniversary) | Member | Medium | S | P2 |
| F15 | Trainer/class/branch dimensions | Future | Low now | L | P2 |

**Nine features carry ~90% of the value: F1–F9.** F10–F15 are additive.

---

## PART 2 — SPEC FOR EACH FEATURE

Each spec is written so it can be built independently, in any order, after P0.

---

### F1 · One session per Saturday  🔴 P0 · foundation

**Problem:** sessions are created ad-hoc and duplicate per day.

**Change:** make the session document ID the **date** — `sessions/2026-07-25`.
Creation becomes idempotent: same day → same doc, always. Duplication becomes
*impossible*, not just unlikely.

```js
// lib/db.js
export function sessionIdFor(d = new Date()) {
  // Local (IST) date, not UTC — a 9pm session must not roll to tomorrow.
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export async function ensureTodaySession() {
  const id = sessionIdFor()
  const ref = doc(db, 'sessions', id)
  const snap = await getDoc(ref)
  if (!snap.exists()) {
    await setDoc(ref, {
      date: id,                       // 'YYYY-MM-DD' — the report key
      status: 'active',
      startedAt: serverTimestamp(),
      endedAt: null,
    })
  }
  return { id, date: id, status: 'active' }
}
```

Also:
- **Re-opening is free.** If staff end the session and someone else arrives,
  tapping simply re-uses the same day's doc (set `status:'active'` again). No new
  session, no split day.
- **Auto-close stale sessions.** If an active session's `date` is not today,
  treat it as ended (a forgotten "End session" must not swallow next week).
- Entry IDs stay `${sessionId}_${memberId}` → now also naturally unique per day.

**Migration for the 8 existing sessions:** a one-off script that merges the three
18 July sessions into `sessions/2026-07-18`, repoints their entries, and deletes
the 17 July test. ~20 lines, run once with the admin key.

**Acceptance:** ending and restarting a session on the same day produces exactly
one session doc; the DB never contains two sessions with the same date.

---

### F2 · Attendance queryable per member  🔴 P0 · foundation

Today entries are only ever queried by `sessionId`. Member history needs the
reverse.

```js
export function subscribeMemberEntries(memberId, cb) {
  const q = query(
    collection(db, 'entries'),
    where('memberId', '==', memberId),
    orderBy('at', 'desc'),
    limit(120),                       // ~2 years of Saturdays
  )
  return onSnapshot(q, (s) => cb(s.docs.map((d) => ({ id: d.id, ...d.data() }))))
}
```

⚠️ **This needs a Firestore composite index** (`memberId ASC, at DESC`). Firestore
prints a one-click creation link in the browser console the first time the query
runs — click it, wait ~1 min. Add it to `firestore.indexes.json` so it deploys
with the project.

**Also store `sessionDate` on each entry at write time.** It is denormalised, but
it turns every report into a pure client-side group-by with zero extra reads:

```js
tx.set(refE, { ...existingFields, sessionDate: session.date })
```

**Acceptance:** opening a member profile returns their entries in one query,
no scanning of all sessions.

---

### F3 · Absence definition  🔴 P0 · the rule everything depends on

"Absent" is not stored — it is *derived*. Get the rule wrong and every number is
wrong.

> **A member is ABSENT for a session if: the session happened, AND the member had
> already joined before it (`member.createdAt <= session.startedAt`), AND no
> entry doc exists for them in that session.**

Corollaries — write these down, they prevent arguments later:
- A member who joined in July is **not absent** for June's Saturdays. They are
  `n/a`. Never show them as a miss.
- **Attendance % = attended ÷ sessions held since that member joined.** Never
  ÷ all sessions ever.
- A **couple** shares a wallet but has **two member docs**, so each attends
  independently. Never merge them in attendance stats.
- **Guests are not members.** They count in headcount and revenue, never in
  attendance % or retention.
- A session with **zero entries** (cancelled, holiday) must be markable as
  `status:'cancelled'` and excluded from everyone's denominator — otherwise a
  rained-out Saturday silently damages every member's attendance score.

```js
export const attendanceOf = (member, sessions, entries) => {
  const joined = member.createdAt?.seconds || 0
  const eligible = sessions.filter(
    (s) => s.status !== 'cancelled' && (s.startedAt?.seconds || 0) >= joined,
  )
  const attendedIds = new Set(entries.map((e) => e.sessionId))
  const attended = eligible.filter((s) => attendedIds.has(s.id))
  return {
    eligible, attended,
    absent: eligible.filter((s) => !attendedIds.has(s.id)),
    pct: eligible.length ? Math.round((attended.length / eligible.length) * 100) : null,
  }
}
```

**Acceptance:** a member created yesterday shows "new — no history yet", not 0%.

---

### F4 · Member Profile page  ⭐ P1 · the one you asked for first

**Route:** `/owner/member/:id` — reached by tapping any name in Owner → People,
Card Tracking, or the Reception search panel. Staff-PIN pages should *link* to it
but it lives under the owner's tree.

**Screen, top to bottom:**

1. **Identity block** — photo, name (+👫 if couple), tier badge, club, city,
   mobile (tap-to-call), member no., "member since Mar 2026".
2. **Four stat tiles** — `Credits left` · `Attendance %` · `Total visits` ·
   `Current streak`. One number each, no sparkline, no decoration.
3. **Attendance strip** — the last ~16 Saturdays as coloured dots, oldest→newest:
   `● green = came · ○ grey = missed · · faint = before they joined`.
   Hovering/tapping a dot shows the date. This single row communicates a
   member's whole story in one glance and is the emotional core of the page.
4. **Present / Absent list** — every eligible session, newest first:
   `25 Jul · ✓ In 6:12pm → left 8:05pm · gate desk · +1 guest`
   `18 Jul · ✗ Absent`
   Group by month with a small `July — 3 of 4` header.
5. **Money** — every recharge and adjustment: date, packs, ₹, method, staff note.
   Plus lifetime totals: `₹ paid` and `credits used`.
6. **Card status** — printed n/n, given n/n + date, card UID (or "no card"),
   buttons: `Print card`, `Replace card/QR`.
7. **Actions row** — `Recharge`, `± Adjust credits`, `Edit details`, `WhatsApp`.

**What must NOT be on this page:**
- ❌ No other member's data, ever (no "compared to club average" leaderboard).
- ❌ No delete button in the main flow — destructive actions go behind Edit.
- ❌ No raw IDs, no Firestore document keys, no debug JSON.
- ❌ Do not show ₹ balance — the model is **credits**. Showing both re-introduces
  the confusion the rebuild removed.
- ❌ No infinite scroll — cap at 24 months with a "show older" button.

**Edge cases:** brand-new member (show "No history yet — first Saturday coming
up"), member with no card, member with `noLogin: true` (hide password-reset),
couples (show partner link if you later add `partnerId`).

**Acceptance:** every claim on the page traces to a document — if it says
"absent 18 Jul", there is a session on 18 Jul, no entry, and joined-before check
passes.

---

### F5 · Session Report (one Saturday)  ⭐ P1

**Route:** `/owner/session/:date` (e.g. `/owner/session/2026-07-25`), opened from
the "Past Saturdays" list on Owner → Today.

**Screen:**

1. **Header** — `Saturday 25 July` · opened 5:58pm · closed 8:40pm · duration.
2. **Six tiles** — `Attended` · `Absent` · `Guests` · `New members` ·
   `₹ collected` · `Credits used`.
3. **Arrivals timeline** — a simple bar per 15-minute bucket. Answers the only
   operational question that matters: *when do we need staff at the door?*
4. **Who came** — photo rows, arrival time, guests, gate, time-in-room.
   Sortable by arrival time (default) or name.
5. **Who didn't come** — the same list style, greyed. **Each row gets a WhatsApp
   button** — this list is the reason the report exists: it converts into
   follow-up in one tap.
6. **Money on the day** — cash vs UPI vs total, itemised recharges.
7. **Export** — `Print / PDF` + `CSV`.

**Must NOT:** no per-member judgement language ("poor attendance"); no financial
detail on any screen a member could see; never show the absent list on a public
or door-facing screen.

**Acceptance:** attended + absent = eligible members for that date, exactly.

---

### F6 · Month-End Report  ⭐ P1

**Route:** `/owner/month/:yyyy-mm` — plus a month picker on Owner → Money.

**Sections:**

1. **The month in one line** — `July 2026 · 4 Saturdays · 61 unique members ·
   238 visits · ₹68,400 collected`.
2. **Attendance** — average per Saturday, best/worst Saturday, total unique
   attendees, club-wide attendance % (visits ÷ eligible member-Saturdays).
3. **Revenue** — total, cash vs UPI, packs sold, revenue by tier, average per
   member. Compare to previous month with ▲/▼ and the % change.
4. **Members** — joined this month, first-timers who came back, **at-risk**
   (missed last 2), **dormant** (missed 4+), zero-credit count.
5. **Top attenders** — the 10 most regular members. This is the club's
   recognition list — print it, read the names out at the next session.
6. **Per-member table** — name · visits/4 · attendance % · credits left · ₹ paid.
   Sortable, exportable. This one table answers most owner questions.
7. **Export** — Print/PDF (owner shows the club owner) + CSV (accounting).

**Design note:** the month report is *read*, not *operated*. Wide margins, large
numbers, plenty of white space, no controls except the month picker and export.
It should look like a document, not a dashboard.

**Must NOT:** don't invent metrics you can't defend (no "engagement score" out of
thin air); don't project future revenue from 4 data points; never auto-email it
anywhere without an explicit action.

---

### F7 · Attendance Matrix  ⭐ P1 · the "wow" view

**Route:** `/owner/matrix`

Members down the left, Saturdays across the top, one cell each:
`✓ green` attended · `· grey` absent · blank = not yet a member.

- Sticky first column + sticky header row; horizontal scroll for older dates.
- Right-hand column: attendance %. Sort by it → the whole club ranked by
  regularity in one screen.
- Click any cell → that member's profile at that date.
- Default window: **last 12 Saturdays** (fits a laptop screen; older via scroll).

This is the single most requested view in every club system and it is cheap to
build once F2/F3 exist — pure client-side grid over data already loaded.

**Must NOT:** don't colour-code red for absence (it reads as blame on a printed
sheet the whole club might see); grey is enough.

---

### F8 · Member's own history  ⭐ P1 · member-facing

Add to the member Dashboard, below the card:
- `You've attended 12 of 15 Saturdays` + the same 16-dot strip as F4.
- Current streak with a small flame at 3+.
- Their own recharge history (already partly there).

**Must NOT:** never show other members, never show club totals, never show money
they didn't pay. Their own data only — this is also what the security rules
enforce.

---

### F9 · At-risk / follow-up list  ⭐ P1 · highest business value per hour of work

**Route:** a tab on Owner → People, or a card on Owner → Today.

Three buckets, computed from F3:
- **Slipping** — attended before, missed the **last 1** Saturday.
- **At risk** — missed the **last 2** consecutive.
- **Dormant** — missed **4+**, i.e. a month gone.

Each row: photo, name, last seen date, attendance %, credits left, and a
**WhatsApp button** with a pre-filled message:

```
Hi {name} 👋 We missed you at Saturday Training the last couple of weeks.
This Saturday 6pm — hope to see you! 🌿
```

> Retention research is unambiguous that this is where the money is: improving
> retention ~5% moves fitness-business revenue 25–30%. A list of 6 names to
> message on Sunday morning is worth more than any chart on this page.

**Must NOT:** no automated bulk messaging (it will get the club's number blocked
and it feels robotic); a human presses send, one at a time.

---

### F10–F15 · Later (short specs)

- **F10 Export** — one shared `exportCsv(rows, filename)` helper + the existing
  print CSS pattern. Every report gets both buttons. No PDF library needed —
  browser Print → "Save as PDF" is enough, as the poster/cards already prove.
- **F11 Staff activity log** — write `by: 'staff'|'owner'` + device label on every
  recharge/adjust; render as a plain audit list. Cheap insurance for cash
  disputes.
- **F12 Guest conversion** — `guests` is a count today. To track conversion,
  capture guest name/mobile at the desk, then match on mobile when they sign up
  → "3 of 11 guests became members this month".
- **F13 Reminder list** — members with `credits <= 1`, ordered by attendance %.
  Reception works this list at the door; also drives F9's WhatsApp.
- **F14 Milestones** — 10th/25th/50th visit and join anniversary; show a small
  badge on the profile and a "celebrate today" line on Owner → Today.
- **F15 Trainer / class / branch** — only if the club expands. Would add a
  `trainerId`/`classType` to sessions and a filter to every report. Do not build
  speculatively.

---

## PART 3 — INFORMATION ARCHITECTURE (where everything goes)

Keep the current 3-surface discipline. **All reporting lives under Owner.**
Reception stays a single-purpose tap screen forever.

```
MEMBER (login)
  /                      card · credits · pass · own history (F8)
  /profile               edit own details

STAFF (4-digit PIN)                    ← must stay fast & boring
  /admin                 Reception — tap → green. NO reports here.
  /admin/print           Card Studio
  /admin/cards           Card Tracking
  /feed                  public live board (view-only)

OWNER (email login)                    ← ALL reporting lives here
  /owner                 Today · People · Money · Print   (existing tabs)
    + Reports tab  →     Sessions · Months · Matrix · At-risk
  /owner/member/:id      F4  Member profile
  /owner/session/:date   F5  One Saturday
  /owner/month/:yyyy-mm  F6  Month end
  /owner/matrix          F7  Attendance grid
```

**Rules of placement**
1. **Nothing new on `/admin`.** During a rush the receptionist needs one job.
   Every report added to Reception costs seconds per member at the door.
2. **The door screen and `/feed` never show history, money, or absence.** They
   are public surfaces; treat them as such.
3. **Reports are reached from a name or a date** — tapping a person or a
   Saturday is the natural entry, not a menu of report types.
4. **One level deep.** Owner tab → report. Never a report inside a report inside
   a modal.

---

## PART 4 — DESIGN RULES (how it should look — and must not)

**Do**
- One screen answers **one question**. Name it in the heading.
- **Numbers first, then the list that explains them.** Tiles at the top, detail
  below.
- Empty states must teach: *"No sessions yet — the first tap on Saturday starts
  one."* Never a blank panel.
- Dates always human: `Sat 25 Jul`, not `2026-07-25T18:12:03Z`.
- Present/absent uses **shape + colour + text**, never colour alone (prints in
  greyscale, and ~8% of men can't separate red/green).
- Reuse the existing tokens/classes (`.card`, `.mstat`, `.seg`, `.hist-row`) so
  day/night theming keeps working for free.
- Every report must be **printable** — the owner will show these on paper.

**Don't**
- ❌ No charting library. The needs here are bars and dots — a `<div>` with a
  width % beats 300 KB of JavaScript and themes correctly.
- ❌ No dashboard wall of 12 tiles. Four tiles that get read beat twelve that
  don't.
- ❌ No red for absence on shared screens; no shaming language anywhere.
- ❌ No decimals in people counts; no ₹ with paise; no "0.0%" — show `—`.
- ❌ No auto-refresh animation on report pages (it's a document, not a live
  board) — only `/admin` and `/feed` are live.
- ❌ Never show money on a member-facing surface beyond their own payments.
- ❌ No horizontal scrolling anywhere except the matrix, which is explicit.

---

## PART 5 — TECHNICAL FOUNDATIONS

**Aggregation strategy — client-side, always (at this scale).**
A month report loads: sessions of the month (~4 docs) + entries of those sessions
(~250) + transactions of the month (~60) + members (82). ≈ 400 documents,
comfortably under a second, and free.

**Indexes required** (add to `firestore.indexes.json`, deploy with the project):
```
entries:      memberId ASC, at DESC
entries:      sessionDate ASC, at ASC
transactions: memberId ASC, createdAt DESC
transactions: type ASC, createdAt DESC
```

**Timezone.** Everything is IST. Always build day keys from **local** date parts,
never `toISOString()` (which is UTC and will file an 11pm Saturday under Sunday).

**Denormalise deliberately.** `entries` already copies `name`/`photoURL`; add
`sessionDate` and `tier`. A renamed member does not rewrite history — that is
correct: reports show what was true on the day.

**Security (rules already support this).** Owner reads everything; staff read
what the board needs; a member reads only their own `entries`/`transactions`.
When F8 ships, verify a logged-in member **cannot** query another member's
entries — add `memberId == request.auth.uid` to the entries read rule for
non-staff.

**Performance guardrails:** cap history at 120 entries/24 months per member;
matrix defaults to 12 Saturdays; never subscribe to `entries` collection-wide.

**Testing with real data:** attendance logic is easy to get subtly wrong. Before
trusting any report, verify **one member by hand** against the raw docs, and
check that `attended + absent = eligible` on a session report.

---

## PART 6 — BUILD ORDER (do it in this sequence)

| Phase | What | Why now | Rough effort |
|---|---|---|---|
| **0 — before next Saturday** | F1 session-per-day + merge script · F2 index + `sessionDate` on entries · F3 absence helpers (pure functions, no UI) | Data lost today is unrecoverable | Half a day |
| **1 — the core three** | F4 Member profile · F5 Session report · F9 At-risk list | Answers "who came, who didn't, who's slipping" | 2–3 days |
| **2 — the month** | F6 Month-end report · F10 Export · F8 member's own history | Owner's monthly review + member delight | 2 days |
| **3 — the grid & ops** | F7 Matrix · F11 staff log · F13 reminders | Depth once the basics are trusted | 2 days |
| **4 — growth** | F12 guest conversion · F14 milestones · F15 dimensions | Only if the club asks | later |

**Non-negotiable:** Phase 0 ships before the next Saturday. Phases 1–4 can be as
slow as you like — the data will be waiting.

---

## PART 7 — DEFINITION OF DONE (per report)

A report is finished only when **all** of these are true:
1. Every number traces to documents (spot-check one member by hand).
2. `attended + absent = eligible` holds on a session report.
3. New members are `n/a`, never "absent", for sessions before they joined.
4. Cancelled sessions are excluded from all denominators.
5. It prints on one page without controls or dark backgrounds.
6. It reads correctly in **both** day and night themes.
7. It works with zero data (helpful empty state) and with 500 members (no lag).
8. No member-facing surface exposes another member's data.
9. IST dates are correct at 11pm on a Saturday.
10. Nothing was added to `/admin` Reception.

---

## PART 8 — WHAT NOT TO BUILD (deliberately excluded)

- **Push notifications / auto-emails** — WhatsApp by hand converts better and
  costs nothing.
- **Native mobile app** — the web app already installs to the home screen.
- **Online payments** — the desk model works, cash reconciliation is solved, and
  a gateway adds fees, KYC and refund disputes.
- **Facial recognition / biometrics** — the card + QR is faster and raises no
  privacy questions.
- **Predictive "churn AI"** — with 82 members, "missed the last 2" is more
  accurate and explainable than any model.
- **A separate analytics tool (GA/Metabase/BigQuery)** — the whole dataset fits
  in a browser tab.
- **Per-class booking / schedules** — the club is walk-in; booking was already
  removed once for good reason.

---

## APPENDIX — the one-off session merge (Phase 0)

```
node scripts/merge-sessions.mjs <serviceAccount.json>
```
Groups sessions by local date → keeps the earliest doc, re-points that day's
entries to it (`entries/{date}_{memberId}`), deletes the duplicates, drops the
17 July test, and stamps every session with a `date` field.
**Run a `backup.mjs` first** — it is the only irreversible step in this plan.
