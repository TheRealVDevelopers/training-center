// ---- Saturday Training · configuration ------------------------------------
// The whole money model in one place. Wallets hold CREDITS (1 credit = 1
// entry). Credits sell only in packs; the ₹ price of a pack depends on the
// member's level (tier).

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

// Case-/space-insensitive lookup ("get team", "president's team" both work).
const TIER_INDEX = Object.fromEntries(
  Object.keys(TIERS).map((k) => [k.toLowerCase().replace(/[^a-z0-9]/g, ''), k]),
)
export function resolveTier(raw) {
  if (!raw) return DEFAULT_TIER
  const key = String(raw).toLowerCase().replace(/[^a-z0-9]/g, '')
  return TIER_INDEX[key] || DEFAULT_TIER
}
export function packPrice(tier) {
  return TIERS[resolveTier(tier)] ?? TIERS[DEFAULT_TIER]
}

// Venue capacity, for the "seats left" feel on the owner page.
export const CAPACITY = 150

// The OWNER. This email, logged in, opens the Owner page and bypasses the
// staff PIN everywhere. Staff devices use the 4-digit PIN instead.
export const SUPER_ADMIN_EMAILS = [
  'runfast060425@gmail.com',
]

export const CURRENCY = '₹'
