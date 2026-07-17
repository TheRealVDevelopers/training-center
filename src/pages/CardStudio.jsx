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
          <Link className="btn ghost small" to="/admin/credits">‹ Reception</Link>
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

// One card face, exact CR80 mm geometry. When the tier has final artwork
// (frontImage/backImage), it becomes the full-bleed background and only the
// member fields are overlaid. Until then: a light print-optimized design —
// dye-sub printers band on big dark fills, so white base + solid tier accent
// gives the cleanest possible print.
function CardFace({ member, tier, side, print }) {
  const serial = `TC-${(member.id || '').slice(-4).toUpperCase()}`
  const yrs = parseInt(member.years, 10)
  const joined = Number.isFinite(yrs) && yrs > 0 && yrs < 80 ? new Date().getFullYear() - yrs : null
  const img = side === 'front' ? tier.frontImage : tier.backImage
  const ac = tier.printAccent

  return (
    <div className={`pc-face cs-face pc-light ${print ? 'print' : ''}`} style={{ '--tier': ac }}>
      {img && <img className="pc-bg" src={img} alt="" />}

      {side === 'front' ? (
        <>
          <div className="pc-head">
            <div className="pc-brand">
              <span className="pc-leaf" style={{ background: ac }}>🌿</span>
              <span className="pc-club">SATURDAY TRAINING<small>HERBALIFE NUTRITION CLUB</small></span>
            </div>
            <span className="pc-chip" style={{ color: ac, borderColor: `${ac}55`, background: `${ac}14` }}>
              {tier.label.toUpperCase()}
            </span>
          </div>
          <div className="pc-id">
            {member.photoURL
              ? <img className="pc-photo" src={member.photoURL} alt="" crossOrigin="anonymous" />
              : <span className="pc-photo fb" style={{ background: ac }}>{(member.name || '?')[0]}</span>}
            <div>
              <div className="pc-name">{member.name}</div>
              {member.position && <div className="pc-pos" style={{ color: ac }}>{member.position}</div>}
              {member.clubName && <div className="pc-clubname">{member.clubName}</div>}
            </div>
          </div>
          <div className="pc-facts">
            <div><b>{joined || '—'}</b><span>JOINED</span></div>
            <div><b>{Number.isFinite(yrs) ? `${yrs} yrs` : '—'}</b><span>HERBALIFE</span></div>
            <div><b>{member.city || '—'}</b><span>CITY</span></div>
          </div>
          <div className="pc-foot">
            <span>No. {serial}</span>
            <span className="pc-tap" style={{ color: ac }}>))) TAP TO ENTER</span>
          </div>
        </>
      ) : (
        <>
          <div className="pc-bhead">))) TAP OR SCAN TO WALK IN</div>
          <div className="pc-bmid">
            <div className="pc-btext">
              <div className="pc-bname">{member.name}</div>
              <div className="pc-bsub">Member ID <b style={{ color: ac }}>{serial}</b></div>
              <div className="pc-fine"><b>No money is stored on this card</b> — your balance is safe in your account. If found, please return to the club.</div>
            </div>
            <div className="pc-qr">
              <QRCodeCanvas value={member.memberToken || serial} size={280} level="M" includeMargin={false} />
            </div>
          </div>
        </>
      )}
    </div>
  )
}
