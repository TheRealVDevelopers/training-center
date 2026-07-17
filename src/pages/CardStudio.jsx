import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { QRCodeCanvas } from 'qrcode.react'
import { subscribeMembers, updateMemberProfile, ensureMemberToken } from '../lib/db'
import { CARD_TIERS, tierByKey, detectTier } from '../cards/cardTiers'

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
      await updateMemberProfile(sel.id, { level: key })
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

  return (
    <div className="page wide cardstudio">
      <div className="cardstudio-ui">
        <header className="topbar">
          <div>
            <div className="brand"><span className="leaf">🌿</span>Card Studio</div>
            <div className="muted small">Select member → design picks itself → print</div>
          </div>
          <div className="row gap">
            <Link className="btn ghost small" to="/admin/testcard">🎨 Test prints</Link>
            <Link className="btn ghost small" to="/admin/credits">‹ Reception</Link>
          </div>
        </header>

        <div className="cs-cols">
          <div className="card cs-left">
            <label>Search member</label>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name or mobile…" />
            <div className="memberlist">
              {filtered.map((m) => (
                <button key={m.id} className={`memberrow ${selected === m.id ? 'sel' : ''}`} onClick={() => setSelected(m.id)}>
                  <span>
                    {m.photoURL ? <img className="avatar xs" src={m.photoURL} alt="" /> : <span className="avatar-fallback sm">{(m.name || '?')[0]}</span>}
                    <span className="mname">{m.name}</span>
                  </span>
                  <span className="muted small">{tierByKey(detectTier(m)).label}</span>
                </button>
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
                  <p className="muted small" style={{ margin: '10px 0 0' }}>
                    One click — the Asmi flips the card and prints both sides automatically.
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
  const joined = Number.isFinite(yrs) && yrs > 0 && yrs < 80 ? new Date().getFullYear() - yrs : null
  const img = side === 'front' ? tier.frontImage : tier.backImage
  const grad = `linear-gradient(135deg, ${tier.printAccent} 0%, ${tier.bgDark || tier.printAccent} 100%)`

  return (
    <div className={`pc-face cs-face bc-face ${print ? 'print' : ''}`} style={{ background: grad }}>
      {img && <img className="pc-bg" src={img} alt="" />}

      {side === 'front' ? (
        <>
          <div className="bc-club" style={{ fontSize: (member.clubName || '').length > 28 ? '1.9mm' : '2.2mm' }}>
            🌿 {(member.clubName || 'HERBALIFE NUTRITION CLUB').toUpperCase()}
          </div>
          <div className="bc-levelrow"><span className="bc-level">{tier.label.toUpperCase()}</span></div>
          <div className="bc-chiprow">
            <Chip />
            <svg className="bc-cwaves" viewBox="0 0 24 24" aria-hidden="true">
              {[5, 10, 15].map((r) => (
                <path key={r} d={`M ${6 + r * 0.2} ${12 - r} A ${r} ${r} 0 0 1 ${6 + r * 0.2} ${12 + r}`} fill="none" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" opacity="0.9" />
              ))}
            </svg>
          </div>
          <div className="bc-bottom">
            <div className="bc-lbl">MEMBER</div>
            <div className="bc-name">{(member.name || '').toUpperCase()}</div>
            <div className="bc-meta">
              ID: {serial}{joined ? `   JOINED: ${joined}` : ''}{member.city ? `   ${member.city.toUpperCase()}` : ''}
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="bc-tap">TAP TO ENTER <span className="bc-sig">)))</span></div>
          <div className="bc-bgrid">
            <div>
              <div className="bc-scanlbl">SCAN FOR PROFILE ACCESS</div>
              <div className="bc-qr">
                <QRCodeCanvas value={member.memberToken || serial} size={280} level="M" includeMargin={false} fgColor="#111111" bgColor="#ffffff" />
              </div>
            </div>
            <div className="bc-contact">
              <div className="bc-cname">{member.name}</div>
              {member.mobile && <div>{member.mobile}</div>}
              {member.email && (
                <div className="bc-mail" style={{ fontSize: member.email.length > 32 ? '1.9mm' : member.email.length > 26 ? '2.2mm' : '2.6mm' }}>
                  {member.email}
                </div>
              )}
              <div className="bc-note">No money is stored on this card — balance stays safe in your account.</div>
            </div>
          </div>
          <div className="bc-power">POWERED BY THE REAL V DEVELOPERS · THEREALVDEVELOPERS.IN</div>
        </>
      )}
    </div>
  )
}

// Gold EMV-style chip: shows members there's a real chip inside the card.
function Chip() {
  return (
    <svg className="bc-chip" viewBox="0 0 30 24" aria-hidden="true">
      <defs>
        <linearGradient id="chipgold" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f6dc93" />
          <stop offset="0.5" stopColor="#d9b25c" />
          <stop offset="1" stopColor="#b8934a" />
        </linearGradient>
      </defs>
      <rect x="0.8" y="0.8" width="28.4" height="22.4" rx="3.6" fill="url(#chipgold)" stroke="#8a6d33" strokeWidth="0.6" />
      <path d="M 0.8 8 H 10 M 0.8 16 H 10 M 20 8 H 29.2 M 20 16 H 29.2 M 15 0.8 V 6 M 15 18 V 23.2 M 10 8 C 13 9.5, 13 14.5, 10 16 M 20 8 C 17 9.5, 17 14.5, 20 16"
        fill="none" stroke="#8a6d33" strokeWidth="0.7" />
    </svg>
  )
}
