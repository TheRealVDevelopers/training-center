// ---- Prototype configuration (V1) ----------------------------------------
// Tune these for your venue. They are used when an admin starts a new session.

export const SESSION = {
  feePerPerson: 300, // ₹ deducted per person at check-in
  capacity: 150, // total seats for "remaining seats" math
}

// Max guests a single member can book per session.
export const MAX_GUESTS_PER_SESSION = 3

// One-click reception recharge: everyone tops up in blocks of this many credits
// (price differs per tier, but the credit count is the same). One credit = one
// entry.
export const RECHARGE_CREDITS = 5

// ---- Tier pricing ---------------------------------------------------------
// Credits are ALWAYS sold in packs of PACK_CREDITS. The ₹ a member pays for a
// pack depends on their tier (level). One credit = one entry = one session.
export const PACK_CREDITS = 5

// tier name → ₹ for one pack of PACK_CREDITS credits.
export const TIERS = {
  'Associate': 300,
  'Supervisor': 300,
  'World Team': 300,
  'GET TEAM': 1000,
  'GET 2500': 1000,
  'Millionaire 4000': 1500,
  'Millionaire 7500': 1500,
  'Presidents Team': 2000,
}
export const DEFAULT_TIER = 'Associate'

// Case-/space-insensitive lookup so a CSV value like "get team" or
// "president's team" still resolves to the right tier.
const TIER_INDEX = Object.fromEntries(
  Object.keys(TIERS).map((k) => [k.toLowerCase().replace(/[^a-z0-9]/g, ''), k]),
)
export function resolveTier(raw) {
  if (!raw) return DEFAULT_TIER
  const key = String(raw).toLowerCase().replace(/[^a-z0-9]/g, '')
  return TIER_INDEX[key] || DEFAULT_TIER
}
// ₹ for one pack, for this tier.
export function packPrice(tier) {
  return TIERS[resolveTier(tier)] ?? TIERS[DEFAULT_TIER]
}
// ₹ value of a single credit, for this tier.
export function pricePerCredit(tier) {
  return packPrice(tier) / PACK_CREDITS
}

// Walk-in mode: members just tap their card / show their permanent QR to enter
// (no booking step). Set false to fall back to the older book-a-slot flow.
export const WALKIN_MODE = true

// The SUPER ADMIN (owner). Only this email, logged in, can open /super to
// generate the access codes — and is auto-allowed into /admin and /door
// without needing a code. Everyone else uses a 6-digit code instead of an
// account (see CodeGate + SuperAdmin).
export const SUPER_ADMIN_EMAILS = [
  'runfast060425@gmail.com',
]

export const CURRENCY = '₹'
