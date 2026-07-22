import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { QRCodeCanvas } from 'qrcode.react'
import { subscribeMembers, updateMemberProfile, ensureMemberToken, addMemberDirect } from '../lib/db'
import { TIERS } from '../config'
import { CARD_TIERS, tierByKey, detectTier, KEY_TO_TIER } from '../cards/cardTiers'

// Card Studio — the printing desk. Pick a member, their level picks the design
// automatically (dropdown to correct it — the correction is saved), then Print
// Front / Print Back sends the exact CR80 card to the Evolis.
// On the station PC run Chrome with --kiosk-printing to skip the print dialog.
export default function CardStudio() {
  const [params] = useSearchParams()
  const [members, setMembers] = useState([])
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(params.get('m') || null)
  const [tierKey, setTierKey] = useState('associate')
  const [printSide, setPrintSide] = useState('front')
  const [msg, setMsg] = useState('')

  useEffect(() => subscribeMembers(setMembers), [])

  const sel = members.find((m) => m.id === selected) || null

  // When a member is picked, adopt their saved/detected level and make sure
  // they have a QR token to print.
  useEffect(() => {
    if (!sel) return
    setTierKey(detectTier(sel))
    if (!sel.memberToken) ensureMemberToken(sel).catch(() => {})
  }, [selected, sel?.level, sel?.position]) // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return members
    return members.filter(
      (m) => (m.name || '').toLowerCase().includes(q) || (m.mobile || '').includes(q),
    )
  }, [members, search])

  const tier = tierByKey(tierKey)

  async function changeTier(key) {
    setTierKey(key)
    if (!sel) return
    try {
      // Save the PRICING tier (the same field the Owner page uses) so the
      // card design and their pack price always agree.
      await updateMemberProfile(sel.id, { tier: KEY_TO_TIER[key] || 'Associate', tierNeedsReview: false })
      setMsg(`✓ Level saved: ${tierByKey(key).label}`)
      setTimeout(() => setMsg(''), 2500)
    } catch (e) {
      setMsg(e.message)
    }
  }

  function printCard(side) {
    setPrintSide(side)
    setTimeout(() => window.print(), 80) // let the print zone re-render first
  }

  // ---- Print queue: burn through the unprinted backlog fast ----------------
  // Couples need TWO identical cards (one each), singles one. Progress is a
  // count (printedCount), kept in sync with the cardPrinted flag other pages use.
  const neededOf = (m) => (m.couple ? 2 : 1)
  const printedOf = (m) => Math.min(neededOf(m), m.printedCount ?? (m.cardPrinted ? neededOf(m) : 0))
  const remainingOf = (m) => neededOf(m) - printedOf(m)

  const membersRef = useRef([])
  useEffect(() => { membersRef.current = members }, [members])
  const selectedRef = useRef(null)
  useEffect(() => { selectedRef.current = selected }, [selected])
  const printSideRef = useRef('front')
  useEffect(() => { printSideRef.current = printSide }, [printSide])

  const unprinted = useMemo(
    () => members.filter((m) => remainingOf(m) > 0).sort((a, b) => (a.name || '').localeCompare(b.name || '')),
    [members], // eslint-disable-line react-hooks/exhaustive-deps
  )
  const cardsLeft = unprinted.reduce((n, m) => n + remainingOf(m), 0)

  function bumpPrinted(id) {
    const m = membersRef.current.find((x) => x.id === id)
    if (!m) return Promise.resolve()
    const next = Math.min(neededOf(m), printedOf(m) + 1)
    return updateMemberProfile(id, { printedCount: next, cardPrinted: next >= neededOf(m) })
  }
  function jumpNext(excludeId) {
    const next = unprinted.find((m) => m.id !== excludeId)
    if (next) setSelected(next.id)
    else setMsg('🎉 All cards printed!')
  }
  function togglePrinted(m) {
    const needed = neededOf(m)
    const next = (printedOf(m) + 1) % (needed + 1)
    updateMemberProfile(m.id, { printedCount: next, cardPrinted: next >= needed }).catch(() => {})
  }

  // ---- Quick create: type a name + level -> card ready to print ------------
  // For people who won't sign up themselves (e.g. the club owner): no email,
  // no login — the profile + QR are created instantly and the card prints.
  const [creating, setCreating] = useState(false)
  const [nf, setNf] = useState({ name: '', tier: 'Associate', clubName: '', couple: false })
  const [creatingBusy, setCreatingBusy] = useState(false)
  async function createAndSelect() {
    if (!nf.name.trim()) return
    setCreatingBusy(true)
    try {
      const id = await addMemberDirect(nf)
      setCreating(false)
      setNf({ name: '', tier: 'Associate', clubName: '', couple: false })
      setSelected(id)
      setMsg(`✓ ${nf.name} created — print the card`)
    } catch (e) {
      setMsg(e.message)
    } finally {
      setCreatingBusy(false)
    }
  }

  // ---- BATCH: one click prints every unprinted card, hands-free ------------
  // Chrome on the station PC runs with --kiosk-printing, so each print goes
  // straight to the Evolis with no dialog; 'afterprint' fires when the job is
  // spooled -> mark printed -> select the next member -> print again.
  const [batch, setBatch] = useState(null) // { ids, i } | null
  const batchRef = useRef(null)

  function startBatch() {
    // Couples appear twice in the run — two identical cards, back to back.
    const ids = unprinted.flatMap((m) => Array(remainingOf(m)).fill(m.id))
    if (!ids.length) return
    if (!window.confirm(`Print ALL ${ids.length} unprinted cards now (couples get 2 copies)?\n\nMake sure the printer has enough blank cards and ribbon, and Chrome runs with --kiosk-printing (no dialogs).`)) return
    setPrintSide('both')
    const b = { ids, i: 0 }
    batchRef.current = b
    setBatch(b)
    setSelected(ids[0])
    setTimeout(() => window.print(), 700) // let the first card render
  }
  function stopBatch() {
    batchRef.current = null
    setBatch(null)
    setMsg('⏹ Batch stopped — already-sent cards keep printing from the Windows queue.')
  }
  useEffect(() => {
    function onAfterPrint() {
      const b = batchRef.current
      if (!b) {
        // Manual print: a full-card print (front+back) auto-marks ✓ printed.
        if (printSideRef.current === 'both' && selectedRef.current) {
          bumpPrinted(selectedRef.current).catch(() => {})
        }
        return
      }
      bumpPrinted(b.ids[b.i]).catch(() => {})
      const next = b.i + 1
      if (next >= b.ids.length) {
        batchRef.current = null
        setBatch(null)
        setMsg(`🎉 Batch done — ${b.ids.length} cards sent to the printer.`)
        return
      }
      const nb = { ids: b.ids, i: next }
      batchRef.current = nb
      setBatch(nb)
      setSelected(nb.ids[next])
      setTimeout(() => window.print(), 1000) // render + let the spooler breathe
    }
    window.addEventListener('afterprint', onAfterPrint)
    return () => window.removeEventListener('afterprint', onAfterPrint)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="page wide cardstudio">
      <div className="cardstudio-ui">
        <header className="topbar">
          <div>
            <div className="brand"><span className="leaf">🌿</span>Card Studio</div>
            <div className="muted small">Select member → design picks itself → print</div>
          </div>
          <div className="row gap">
            {batch ? (
              <>
                <span className="live-pill"><span className="live-dot" />Printing {batch.i + 1} of {batch.ids.length} — {members.find((m) => m.id === batch.ids[batch.i])?.name || ''}</span>
                <button className="btn danger small" onClick={stopBatch}>⏹ Stop</button>
              </>
            ) : (
              <>
                <button className="btn primary small" onClick={startBatch} disabled={!cardsLeft}>
                  🖨 Print ALL unprinted ({cardsLeft})
                </button>
                <Link className="btn ghost small" to="/admin/cards">📋 Tracking</Link>
                <button className="btn ghost small" onClick={() => jumpNext(null)} disabled={!unprinted.length}>▶ Next</button>
                <Link className="btn ghost small" to="/admin/testcard">🎨 Test prints</Link>
                <Link className="btn ghost small" to="/admin">‹ Reception</Link>
              </>
            )}
          </div>
        </header>

        <div className="cs-cols">
          <div className="card cs-left">
            <button className="btn primary block" onClick={() => setCreating(true)} style={{ marginBottom: 10 }}>
              ＋ New card (no signup — just name &amp; level)
            </button>
            <label>Search member</label>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name or mobile…" />
            <p className="muted small" style={{ margin: '8px 0 0' }}>
              Tick ✓ on everyone who already has a card — then "Print ALL unprinted" runs the rest by itself.
            </p>
            <div className="memberlist">
              {filtered.map((m) => (
                <div key={m.id} className={`memberrow csrow ${selected === m.id ? 'sel' : ''} ${m.couple ? 'couplerow' : ''}`}>
                  <button className="csrow-main" onClick={() => setSelected(m.id)}>
                    {m.photoURL ? <img className="avatar xs" src={m.photoURL} alt="" /> : <span className="avatar-fallback sm">{(m.name || '?')[0]}</span>}
                    <span className={`mname ${m.couple ? 'couplename' : ''}`}>{m.name}{m.couple ? ' 👫' : ''}</span>
                    <span className="muted small">{tierByKey(detectTier(m)).label}{m.couple ? ' · ×2' : ''}</span>
                  </button>
                  <button
                    className={`cs-ptoggle ${printedOf(m) >= neededOf(m) ? 'on' : printedOf(m) > 0 ? 'half' : ''}`}
                    title={`Printed ${printedOf(m)} of ${neededOf(m)} — click to advance`}
                    onClick={() => togglePrinted(m)}
                  >
                    {printedOf(m) >= neededOf(m) ? '✓' : printedOf(m) > 0 ? `${printedOf(m)}/${neededOf(m)}` : '○'}
                  </button>
                </div>
              ))}
              {filtered.length === 0 && <div className="muted small">No members match.</div>}
            </div>
          </div>

          <div className="cs-right">
            {!sel && (
              <div className="card center-text"><div className="empty"><span className="ico">🖨️</span><div className="t">Pick a member</div><div className="small">Their card preview appears here.</div></div></div>
            )}
            {sel && (
              <>
                <div className="card cs-controls">
                  <div className="row between" style={{ flexWrap: 'wrap', gap: 10 }}>
                    <div>
                      <div className="strong" style={{ fontSize: 17 }}>{sel.name}</div>
                      <div className="muted small">{sel.position || 'No position given'}</div>
                    </div>
                    <div>
                      <label style={{ margin: '0 0 4px' }}>Card design / level</label>
                      <select value={tierKey} onChange={(e) => changeTier(e.target.value)}>
                        {CARD_TIERS.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
                      </select>
                    </div>
                  </div>
                  {msg && <div className="banner">{msg}</div>}
                  <div className="row gap" style={{ marginTop: 12 }}>
                    <button className="btn primary" onClick={() => printCard('both')}>🖨 Print CARD (front + back)</button>
                    <button className="btn small" onClick={() => printCard('front')}>Front only</button>
                    <button className="btn small" onClick={() => printCard('back')}>Back only</button>
                  </div>
                  <div className="row gap" style={{ marginTop: 10 }}>
                    <button className="btn" onClick={() => jumpNext(sel.id)}>Next unprinted ▶</button>
                    <span className={`tag ${printedOf(sel) >= neededOf(sel) ? 'ok' : 'muted'}`}>
                      printed {printedOf(sel)}/{neededOf(sel)}{sel.couple ? ' 👫' : ''}
                    </span>
                  </div>
                  <p className="muted small" style={{ margin: '10px 0 0' }}>
                    Printing a card marks it ✓ printed automatically (couples count 2). Front-only / back-only reprints don't count.
                  </p>
                </div>

                <div className="cs-previews">
                  <div><div className="cs-lbl">FRONT</div><CardFace member={sel} tier={tier} side="front" /></div>
                  <div><div className="cs-lbl">BACK</div><CardFace member={sel} tier={tier} side="back" /></div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Quick-create panel */}
      {creating && (
        <div className="recharge-overlay" onClick={() => setCreating(false)}>
          <div className="recharge-panel" onClick={(e) => e.stopPropagation()}>
            <div className="recharge-head">
              <div>
                <div className="recharge-name">New card</div>
                <div className="muted small">No smartphone or signup needed — type, print, hand over.</div>
              </div>
              <button className="btn ghost small" onClick={() => setCreating(false)}>✕</button>
            </div>
            <label>Name *</label>
            <input value={nf.name} onChange={(e) => setNf({ ...nf, name: e.target.value })} autoFocus placeholder="e.g. Club Owner Madam" />
            <label>Level</label>
            <select value={nf.tier} onChange={(e) => setNf({ ...nf, tier: e.target.value })}>
              {Object.keys(TIERS).map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <label>Club name (optional)</label>
            <input value={nf.clubName} onChange={(e) => setNf({ ...nf, clubName: e.target.value })} />
            <label className="row gap" style={{ alignItems: 'center', marginTop: 8 }}>
              <input type="checkbox" checked={nf.couple} onChange={(e) => setNf({ ...nf, couple: e.target.checked })} style={{ width: 'auto' }} />
              Couple — needs 2 cards
            </label>
            <button className="btn primary block" disabled={creatingBusy || !nf.name.trim()} onClick={createAndSelect}>
              {creatingBusy ? 'Creating…' : 'Create → ready to print'}
            </button>
          </div>
        </div>
      )}

      {/* Print zone — the only thing the printer sees. 'both' renders two
          pages in one job; the Asmi flips the card and prints both sides. */}
      {sel && (
        <div className="cs-printzone">
          <style>{`@media print { @page { size: 86mm 54mm; margin: 0; } }`}</style>
          {(printSide === 'both' || printSide === 'front') && (
            <div className="cs-sheet"><CardFace member={sel} tier={tier} side="front" print /></div>
          )}
          {(printSide === 'both' || printSide === 'back') && (
            <div className="cs-sheet"><CardFace member={sel} tier={tier} side="back" print /></div>
          )}
        </div>
      )}
    </div>
  )
}

// One card face, exact CR80 mm geometry. Bank-card design: the LEVEL sets the
// card's background color (deep same-hue gradient); all text is bold white
// knockout (no ink layered on the letters -> no double edges); gold chip +
// contactless waves show there's NFC inside. If a tier gets final artwork
// (frontImage/backImage) it replaces the background.
function CardFace({ member, tier, side, print }) {
  const serial = `TC-${(member.id || '').slice(-4).toUpperCase()}`
  const yrs = parseInt(member.years, 10)
  const hasYrs = Number.isFinite(yrs) && yrs > 0 && yrs < 80
  const since = hasYrs ? new Date().getFullYear() - yrs : null
  const img = side === 'front' ? tier.frontImage : tier.backImage
  const ac = tier.printAccent
  // The YMCKO ribbon has NO white — "white" is bare card showing through and
  // reads as a shiny gap. Light tints barely lay ink either. So everything on
  // the colored zone prints in WARM GOLD (same family as the chip): solid ink,
  // readable on every tier color including the black President's card.
  const lite = '#e8c964'

  const grad = `linear-gradient(135deg, ${ac} 0%, ${tier.bgDark || ac} 100%)`

  return (
    <div className={`pc-face cs-face pr-face ${print ? 'print' : ''}`} style={{ background: grad }}>
      {img && <img className="pc-bg" src={img} alt="" />}
      <Guilloche color={lite} />
      <span className="pr-frame" style={{ borderColor: `${lite}88` }} />
      <span className="pr-frame2" style={{ borderColor: `${lite}55` }} />

      {side === 'front' ? (
        <>
          {tier.points && <PointsSeal points={tier.points} />}
          <div className="pr-colorzone">
            <div className="pr-toprow">
              <span className="pr-club" style={{ color: lite }}>🌿 {(member.clubName || 'HERBALIFE NUTRITION CLUB').toUpperCase()}</span>
            </div>
            <div className="pr-chiprow"><Chip /><Waves color={lite} /><span className="pr-nfc" style={{ color: lite }}>NFC</span></div>
          </div>
          <div className="pr-panel">
            <div className="pr-plevel" style={{ color: ac }}>{tier.label.toUpperCase()}</div>
            <span className="pr-accent" style={{ background: ac }} />
            <div className="pr-name">{(member.name || '').toUpperCase()}</div>
            <div className="pr-meta">
              <span><b>ID</b> {serial}</span>
              {since && <span><b>SINCE</b> {since}</span>}
              {hasYrs && <span><b>{yrs}</b> YRS · HERBALIFE</span>}
              {member.city && <span>{member.city.toUpperCase()}</span>}
            </div>
          </div>
        </>
      ) : (
        <div className="pr-panel pr-backpanel">
          <div className="pr-tap">TAP TO ENTER <span style={{ color: ac }}>)))</span></div>
          <div className="pr-bgrid">
            <div>
              <div className="pr-scanlbl">SCAN FOR PROFILE ACCESS</div>
              <div className="pr-qr"><QRCodeCanvas value={member.memberToken || serial} size={300} level="M" includeMargin={false} fgColor="#000000" bgColor="#ffffff" /></div>
            </div>
            <div className="pr-contact">
              <div className="pr-cname">{member.name}</div>
              {member.mobile && <div>{member.mobile}</div>}
              {member.email && (
                <div className="pr-mail" style={{ fontSize: member.email.length > 32 ? '1.9mm' : member.email.length > 26 ? '2.2mm' : '2.6mm' }}>{member.email}</div>
              )}
              <div className="pr-note">No money is stored on this card — your balance stays safe in your account.</div>
            </div>
          </div>
          <div className="pr-power">POWERED BY THE REAL V DEVELOPERS · THEREALVDEVELOPERS.IN</div>
        </div>
      )}
    </div>
  )
}

// Guilloché rosette (hypotrochoid) — the fine spirograph line-work found on
// premium bank cards and currency, drawn in the level's color.
function Guilloche({ color }) {
  const R = 5, r = 3, d = 2.3, turns = 3, steps = 900, cx = 50, cy = 50, s = 4.7
  let pts = ''
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2 * turns
    const x = (R - r) * Math.cos(t) + d * Math.cos(((R - r) / r) * t)
    const y = (R - r) * Math.sin(t) - d * Math.sin(((R - r) / r) * t)
    pts += `${(cx + x * s).toFixed(2)},${(cy + y * s).toFixed(2)} `
  }
  return (
    <svg className="pr-guilloche" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="0.22" />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="0.22" transform="rotate(15 50 50)" opacity="0.7" />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="0.22" transform="rotate(30 50 50)" opacity="0.4" />
    </svg>
  )
}

// Contactless waves in the level color.
function Waves({ color }) {
  return (
    <svg className="pr-waves" viewBox="0 0 24 24" aria-hidden="true">
      {[5, 9.5, 14].map((r) => (
        <path key={r} d={`M ${6} ${12 - r} A ${r} ${r} 0 0 1 ${6} ${12 + r}`} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
      ))}
    </svg>
  )
}

// Gold award seal showing the tier's points (GET 1000/2500, Millionaire
// 4000/7500) — a scalloped medallion, like a wax/foil seal.
function PointsSeal({ points }) {
  const scallops = 28
  const petals = Array.from({ length: scallops }).map((_, i) => {
    const a = (i / scallops) * Math.PI * 2
    return `${(50 + 46 * Math.cos(a)).toFixed(1)},${(50 + 46 * Math.sin(a)).toFixed(1)}`
  }).join(' ')
  // Solid golds only — no gradient defs, so it always prints filled.
  return (
    <svg className="pr-seal" viewBox="0 0 100 100" aria-hidden="true">
      <polygon points={petals} fill="#c9a23a" stroke="#8a6a2a" strokeWidth="1" opacity="0.6" transform="rotate(6.4 50 50)" />
      <circle cx="50" cy="50" r="41" fill="#e8c760" stroke="#8a6a2a" strokeWidth="1.2" />
      <circle cx="50" cy="50" r="35" fill="none" stroke="#8a6a2a" strokeWidth="0.8" opacity="0.8" />
      <text x="50" y="46" textAnchor="middle" fontFamily="'Sora',sans-serif" fontWeight="800" fontSize="26" fill="#5a3d0c">{points}</text>
      <text x="50" y="63" textAnchor="middle" fontFamily="'Sora',sans-serif" fontWeight="800" fontSize="11" letterSpacing="2" fill="#5a3d0c">POINTS</text>
    </svg>
  )
}

// Gold EMV-style chip: shows members there's a real chip inside the card.
function Chip() {
  return (
    <svg className="pr-chip" viewBox="0 0 30 24" aria-hidden="true">
      {/* Solid gold fill — no gradient defs, so the chip always prints filled. */}
      <rect x="0.8" y="0.8" width="28.4" height="22.4" rx="3.6" fill="#e2bb52" stroke="#8a6d33" strokeWidth="0.8" />
      <path d="M 0.8 8 H 10 M 0.8 16 H 10 M 20 8 H 29.2 M 20 16 H 29.2 M 15 0.8 V 6 M 15 18 V 23.2 M 10 8 C 13 9.5, 13 14.5, 10 16 M 20 8 C 17 9.5, 17 14.5, 20 16"
        fill="none" stroke="#8a6d33" strokeWidth="0.8" />
    </svg>
  )
}
