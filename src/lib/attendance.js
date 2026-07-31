// Attendance maths — the single source of truth for "present" and "absent".
// Absence is never stored; it is derived. Get these rules wrong and every
// report is wrong, so they live in one file with one test-able shape.
//
//   A member is ABSENT for a session when ALL of:
//     • the session actually happened (status !== 'cancelled'), AND
//     • the member had already joined before it started, AND
//     • no entry doc exists for them in that session.
//
//   Corollaries (deliberate, do not "fix" these later):
//     • Someone who joined in July is NOT absent for June — they are n/a.
//     • Attendance % divides by sessions held SINCE THEY JOINED, never all.
//     • Couples are two member docs; they attend independently.
//     • Guests are not members: they count in headcount, never in attendance %.
//     • A cancelled Saturday is excluded from everyone's denominator.

const secs = (ts) => ts?.seconds || 0

export function sessionDateOf(session) {
  return session?.date || session?.id || ''
}

/** Sessions this member could have attended, oldest → newest. */
export function eligibleSessions(member, sessions) {
  const joined = secs(member?.createdAt)
  return sessions
    .filter((s) => s.status !== 'cancelled')
    .filter((s) => secs(s.startedAt) >= joined)
    .sort((a, b) => secs(a.startedAt) - secs(b.startedAt))
}

/**
 * Full attendance picture for one member.
 * `entries` = that member's entry docs (any order).
 * Returns rows oldest → newest, each { session, date, present, entry }.
 */
export function attendanceOf(member, sessions, entries) {
  const eligible = eligibleSessions(member, sessions)
  const bySession = new Map(entries.map((e) => [e.sessionId, e]))
  const rows = eligible.map((s) => {
    const entry = bySession.get(s.id) || null
    return { session: s, date: sessionDateOf(s), present: !!entry, entry }
  })
  const attended = rows.filter((r) => r.present)
  return {
    rows,
    eligible,
    attended,
    absent: rows.filter((r) => !r.present),
    total: eligible.length,
    // null (not 0) when they have no eligible sessions yet — a brand-new member
    // must read as "new", never as 0%.
    pct: eligible.length ? Math.round((attended.length / eligible.length) * 100) : null,
    lastSeen: attended.length ? attended[attended.length - 1].date : null,
    streak: currentStreak(rows),
    missedInARow: missedInARow(rows),
  }
}

/** Consecutive attended sessions counting back from the most recent. */
export function currentStreak(rows) {
  let n = 0
  for (let i = rows.length - 1; i >= 0; i--) {
    if (!rows[i].present) break
    n++
  }
  return n
}

/** Consecutive missed sessions counting back from the most recent. */
export function missedInARow(rows) {
  let n = 0
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i].present) break
    n++
  }
  return n
}

/**
 * Retention bucket for the follow-up list.
 *   new       — no eligible sessions yet (just joined)
 *   regular   — came to the most recent session
 *   slipping  — missed the last 1
 *   at-risk   — missed the last 2
 *   dormant   — missed 4+ (a month gone)
 * Someone who has never attended at all is 'never' — a different conversation.
 */
export function riskOf(att) {
  if (!att.total) return 'new'
  if (!att.attended.length) return 'never'
  const miss = att.missedInARow
  if (miss === 0) return 'regular'
  if (miss === 1) return 'slipping'
  if (miss < 4) return 'at-risk'
  return 'dormant'
}

export const RISK_LABEL = {
  new: 'New member',
  never: 'Never attended',
  regular: 'Regular',
  slipping: 'Missed last week',
  'at-risk': 'At risk — missed 2',
  dormant: 'Dormant — a month away',
}

/** Club-wide roll-up for a set of sessions (month report, session report). */
export function clubStats(members, sessions, allEntries) {
  const live = sessions.filter((s) => s.status !== 'cancelled')
  const ids = new Set(live.map((s) => s.id))
  const entries = allEntries.filter((e) => ids.has(e.sessionId))
  const visits = entries.reduce((n, e) => n + 1 + (e.guests || 0), 0)
  const uniqueMembers = new Set(entries.map((e) => e.memberId)).size
  // Denominator: every (member, session) pair the member was eligible for.
  const eligiblePairs = members.reduce((n, m) => n + eligibleSessions(m, live).length, 0)
  return {
    sessions: live.length,
    visits,
    guests: entries.reduce((n, e) => n + (e.guests || 0), 0),
    uniqueMembers,
    avgPerSession: live.length ? Math.round(visits / live.length) : 0,
    attendancePct: eligiblePairs ? Math.round((entries.length / eligiblePairs) * 100) : null,
  }
}
