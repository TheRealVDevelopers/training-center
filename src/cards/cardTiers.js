// Card tier registry — one entry per Herbalife level. When the final designs
// arrive, drop the artwork into src/assets/cards/ and set frontImage/backImage
// (import the files and reference them here). Until then each tier renders a
// styled fallback using its colors, so printing works end-to-end today.
//
// Field placement over artwork is controlled by `layout` (all units in mm on
// the 86 x 54 card): tweak per tier once the real designs define where the
// name / photo / QR spaces are.

export const CARD_TIERS = [
  // printAccent: dye-sub printers band on big dark fills, so cards print on a
  // white base with a strong solid accent per tier (chosen dark enough to read
  // on white). accent stays for on-screen dark-theme uses.
  {
    key: 'president',
    label: "President's Team",
    match: ['president'],
    accent: '#f0c75e',
    printAccent: '#a8790f',
    frontImage: null,
    backImage: null,
  },
  {
    key: 'millionaire',
    label: 'Millionaire Team',
    match: ['millionaire'],
    accent: '#d9dde2',
    printAccent: '#5b6772',
    frontImage: null,
    backImage: null,
  },
  {
    key: 'get',
    label: 'GET Team',
    match: ['get'],
    accent: '#8dff4f',
    printAccent: '#0a8a4a',
    frontImage: null,
    backImage: null,
  },
  {
    key: 'supervisor',
    label: 'Supervisor',
    match: ['supervisor'],
    accent: '#6ec6ff',
    printAccent: '#1769aa',
    frontImage: null,
    backImage: null,
  },
  {
    key: 'associate',
    label: 'Associate / Member',
    match: [],
    accent: '#00e07a',
    printAccent: '#067a3d',
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
