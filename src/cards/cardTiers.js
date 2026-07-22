// Card tier registry — the 8 Herbalife levels with their card colors.
// printAccent: the card's BACKGROUND color (deep, saturated — prints rich);
// bgDark: same hue darkened, for the card's gradient. accent: lighter
// variants for the dark app UI.
// Order matters for detection: more specific levels (7500 / 2500) match first.
// Keys 'millionaire' and 'get' are kept for members whose level was saved
// before the split — they map to the 4000 / 1000 tiers.

export const CARD_TIERS = [
  {
    key: 'president',
    label: "President's Team",
    match: ['president'],
    accent: '#d9d9d9',
    printAccent: '#141414', // black
    bgDark: '#000000',
    frontImage: null,
    backImage: null,
  },
  {
    key: 'mill7500',
    label: 'Millionaire Team 7500',
    match: ['7500'],
    accent: '#f0c75e',
    printAccent: '#9c7409', // gold
    bgDark: '#7d5a0a',
    points: 7500,
    frontImage: null,
    backImage: null,
  },
  {
    key: 'millionaire',
    label: 'Millionaire Team 4000',
    match: ['millionaire'],
    accent: '#cfd6dd',
    printAccent: '#5f6a75', // silver / platinum (deep, prints on white)
    bgDark: '#4d545c',
    points: 4000,
    frontImage: null,
    backImage: null,
  },
  {
    key: 'get2500',
    label: 'GET 2500',
    match: ['2500'],
    accent: '#ffb054',
    printAccent: '#c15c00', // amber orange
    bgDark: '#8f4e02',
    points: 2500,
    frontImage: null,
    backImage: null,
  },
  {
    key: 'get',
    label: 'GET 1000',
    match: ['get'],
    accent: '#ff5c8a',
    printAccent: '#b3164a', // ruby pink
    bgDark: '#7d1233',
    points: 1000,
    frontImage: null,
    backImage: null,
  },
  {
    key: 'world',
    label: 'World Team',
    match: ['world'],
    accent: '#b18cff',
    printAccent: '#5a2d82', // purple
    bgDark: '#3f1c5e',
    frontImage: null,
    backImage: null,
  },
  {
    key: 'supervisor',
    label: 'Supervisor',
    match: ['supervisor'],
    accent: '#e58398',
    printAccent: '#7d1a2b', // maroon
    bgDark: '#541220',
    frontImage: null,
    backImage: null,
  },
  {
    key: 'associate',
    label: 'Associate',
    match: [],
    accent: '#6ec6ff',
    printAccent: '#0e6fb8', // sky blue (deep, print-safe)
    bgDark: '#0c548a',
    frontImage: null,
    backImage: null,
  },
]

export function tierByKey(key) {
  return CARD_TIERS.find((t) => t.key === key) || CARD_TIERS[CARD_TIERS.length - 1]
}

// The card design follows the member's ONE level field (`tier` — the same one
// that sets their price). A Card Studio override (`level`) wins if set.
const TIER_TO_KEY = {
  'Associate': 'associate',
  'Supervisor': 'supervisor',
  'World Team': 'world',
  'GET TEAM': 'get',
  'GET 2500': 'get2500',
  'Millionaire 4000': 'millionaire',
  'Millionaire 7500': 'mill7500',
  'Presidents Team': 'president',
}
export function detectTier(member) {
  if (member?.level) {
    const t = CARD_TIERS.find((x) => x.key === member.level)
    if (t) return t.key
  }
  return TIER_TO_KEY[member?.tier] || 'associate'
}
