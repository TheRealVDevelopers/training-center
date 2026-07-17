// Card tier registry — one entry per Herbalife level. When the final designs
// arrive, drop the artwork into src/assets/cards/ and set frontImage/backImage
// (import the files and reference them here). Until then each tier renders a
// styled fallback using its colors, so printing works end-to-end today.
//
// Field placement over artwork is controlled by `layout` (all units in mm on
// the 86 x 54 card): tweak per tier once the real designs define where the
// name / photo / QR spaces are.

export const CARD_TIERS = [
  {
    key: 'president',
    label: "President's Team",
    match: ['president'],
    accent: '#f0c75e',
    ink: '#fdf6e3',
    grad: 'linear-gradient(150deg, #241a06 0%, #0f0b03 55%, #2a1e08 100%)',
    edge: 'rgba(240, 199, 94, 0.45)',
    frontImage: null,
    backImage: null,
  },
  {
    key: 'millionaire',
    label: 'Millionaire Team',
    match: ['millionaire'],
    accent: '#d9dde2',
    ink: '#f4f6f8',
    grad: 'linear-gradient(150deg, #1c2126 0%, #0b0e11 55%, #20262c 100%)',
    edge: 'rgba(217, 221, 226, 0.4)',
    frontImage: null,
    backImage: null,
  },
  {
    key: 'get',
    label: 'GET Team',
    match: ['get'],
    accent: '#8dff4f',
    ink: '#eef7f0',
    grad: 'linear-gradient(150deg, #0f2418 0%, #0a130e 55%, #0e2a19 100%)',
    edge: 'rgba(0, 224, 122, 0.4)',
    frontImage: null,
    backImage: null,
  },
  {
    key: 'supervisor',
    label: 'Supervisor',
    match: ['supervisor'],
    accent: '#6ec6ff',
    ink: '#eef5fb',
    grad: 'linear-gradient(150deg, #0d1b26 0%, #080f15 55%, #0e2130 100%)',
    edge: 'rgba(110, 198, 255, 0.4)',
    frontImage: null,
    backImage: null,
  },
  {
    key: 'associate',
    label: 'Associate / Member',
    match: [],
    accent: '#00e07a',
    ink: '#eef7f0',
    grad: 'linear-gradient(150deg, #0f2418 0%, #0a130e 55%, #0e2a19 100%)',
    edge: 'rgba(0, 224, 122, 0.35)',
    frontImage: null,
    backImage: null,
  },
]

export function tierByKey(key) {
  return CARD_TIERS.find((t) => t.key === key) || CARD_TIERS[CARD_TIERS.length - 1]
}

// Level comes from the explicit member.level (set in the Card Studio) or is
// guessed from the free-text position they typed at signup.
export function detectTier(member) {
  const s = `${member?.level || ''} ${member?.position || ''}`.toLowerCase()
  for (const t of CARD_TIERS) {
    if (t.match.some((k) => new RegExp(`\\b${k}`, 'i').test(s))) return t.key
  }
  return 'associate'
}
