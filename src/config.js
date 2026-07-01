// ---- Prototype configuration (V1) ----------------------------------------
// Tune these for your venue. They are used when an admin starts a new session.

export const SESSION = {
  feePerPerson: 300, // ₹ deducted per person at check-in
  capacity: 150, // total seats for "remaining seats" math
}

// Max guests a single member can book per session.
export const MAX_GUESTS_PER_SESSION = 3

// The SUPER ADMIN (owner). Only this email, logged in, can open /super to
// generate the access codes — and is auto-allowed into /admin and /scan
// without needing a code. Everyone else uses a 6-digit code instead of an
// account (see CodeGate + SuperAdmin).
export const SUPER_ADMIN_EMAILS = [
  'runfast060425@gmail.com',
]

export const CURRENCY = '₹'
