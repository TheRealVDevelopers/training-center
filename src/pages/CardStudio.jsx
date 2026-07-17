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

// One card face, exact CR80 mm geometry. Design: deep navy + antique gold,
// serif type, gold flowing lines on the right (the approved mockup). If a tier
// ever gets final artwork (frontImage/backImage) it replaces the background.
const NAVY = '#1c2137'
const GOLD = '#f0e2b6'

function CardFace({ member, tier, side, print }) {
  const serial = `TC-${(member.id || '').slice(-4).toUpperCase()}`
  const yrs = parseInt(member.years, 10)
  const joined = Number.isFinite(yrs) && yrs > 0 && yrs < 80 ? new Date().getFullYear() - yrs : null
  const img = side === 'front' ? tier.frontImage : tier.backImage
  const levelText = (member.position || tier.label).toUpperCase()

  return (
    <div className={`pc-face cs-face pc-navy ${print ? 'print' : ''}`}>
      {img && <img className="pc-bg" src={img} alt="" />}
      <Leaves color={tier.accent} />

      {side === 'front' ? (
        <>
          <div className="nv2-badge">
            <span className="nv2-logo">🌿</span>
            <span className="nv2-clubsm">{(member.clubName || 'HERBALIFE NUTRITION CLUB').toUpperCase()}</span>
          </div>
          <div className="nv2-title" style={{ color: tier.accent }}>{tier.label.toUpperCase()}</div>
          <div className="nv2-bottom">
            <div className="nv2-lbl">MEMBER NAME</div>
            <div className="nv2-name">{member.name}</div>
            <div className="nv2-meta">
              ID: {serial}{joined ? `   JOINED: ${joined}` : ''}{member.city ? `   ${member.city.toUpperCase()}` : ''}
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="nv-tap" style={{ color: tier.accent }}>TAP TO ENTER <span className="nv-sig">)))</span></div>
          <div className="nv-bgrid">
            <div>
              <div className="nv-scanlbl">SCAN FOR PROFILE ACCESS</div>
              <div className="nv-qr">
                <QRCodeCanvas value={member.memberToken || serial} size={280} level="M" includeMargin={false} fgColor={NAVY} bgColor={GOLD} />
              </div>
            </div>
            <div className="nv-contact">
              <div className="nv-cname">{member.name}</div>
              {member.mobile && <div>{member.mobile}</div>}
              {member.email && (
                <div className="nv-mail" style={{ fontSize: member.email.length > 32 ? '1.9mm' : member.email.length > 26 ? '2.2mm' : '2.6mm' }}>
                  {member.email}
                </div>
              )}
              <div className="nv-note">No money is stored on this card — balance stays safe in your account.</div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// Botanical branch on the card's right — leaves pick up the tier color.
function Leaves({ color }) {
  const leaves = [
    // [x, y, rotation, scale, colorIndex, opacity]
    [50, 22, -50, 1.1, 0, 0.95], [44, 30, -20, 1.0, 1, 0.9], [53, 34, 30, 1.2, 2, 0.9],
    [42, 42, -55, 0.9, 3, 0.85], [52, 47, 15, 1.1, 1, 0.95], [44, 55, -30, 1.0, 0, 0.9],
    [54, 60, 40, 1.2, 2, 0.85], [43, 67, -15, 0.9, 3, 0.9], [52, 73, 25, 1.1, 0, 0.9],
    [45, 80, -45, 1.0, 1, 0.85], [55, 86, 35, 1.2, 2, 0.9], [48, 12, -35, 0.9, 3, 0.85],
    [57, 16, 20, 1.0, 1, 0.9], [58, 42, 60, 0.8, 3, 0.8],
  ]
  const palette = [color, '#7c9082', '#55685c', '#c9a961']
  return (
    <svg className="nv2-leaves" viewBox="0 0 60 100" preserveAspectRatio="xMaxYMid slice" aria-hidden="true">
      <path d="M 62 96 C 46 74, 42 48, 50 8" stroke="#c9a961" strokeWidth="0.55" fill="none" opacity="0.9" />
      <path d="M 64 70 C 50 60, 44 38, 47 10" stroke="#7c9082" strokeWidth="0.45" fill="none" opacity="0.8" />
      {leaves.map(([x, y, rot, s, ci, op], i) => (
        <ellipse key={i} cx={x} cy={y} rx={4.4 * s} ry={1.8 * s} fill={palette[ci]} opacity={op} transform={`rotate(${rot} ${x} ${y})`} />
      ))}
    </svg>
  )
}
