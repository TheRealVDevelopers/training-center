import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { QRCodeCanvas } from 'qrcode.react'
import { getMember, ensureMemberToken } from '../lib/db'

// Print a member's personalized card at true CR80 size (85.6 x 54 mm) on the
// card printer. Front and back render as separate pages: print the front,
// re-insert the card, print the back (or use duplex if the printer has it).
export default function CardPrint() {
  const { id } = useParams()
  const [member, setMember] = useState(undefined)
  const [side, setSide] = useState('both') // both | front | back

  useEffect(() => {
    let on = true
    getMember(id).then(async (m) => {
      if (!on) return
      if (m && !m.memberToken) m.memberToken = await ensureMemberToken(m)
      setMember(m)
    })
    return () => { on = false }
  }, [id])

  if (member === undefined) return <div className="center muted">Loading member…</div>
  if (!member) return <div className="center muted">Member not found.</div>

  const serial = `TC-${(member.id || '').slice(-4).toUpperCase()}`
  const yrs = parseInt(member.years, 10)
  const joined = Number.isFinite(yrs) && yrs > 0 && yrs < 80 ? new Date().getFullYear() - yrs : null

  return (
    <div className="cardprint-page">
      {/* Card-printer page size — mounted only while this screen is open */}
      <style>{`@media print { @page { size: 86mm 54mm; margin: 0; } }`}</style>

      <div className="cardprint-bar no-print">
        <div>
          <div className="brand"><span className="leaf">🌿</span>Print card · {member.name}</div>
          <div className="muted small">CR80 · 85.6 × 54 mm · print front, flip the card, print back</div>
        </div>
        <div className="row gap">
          <div className="seg">
            <button className={side === 'both' ? 'on' : ''} onClick={() => setSide('both')}>Both</button>
            <button className={side === 'front' ? 'on' : ''} onClick={() => setSide('front')}>Front</button>
            <button className={side === 'back' ? 'on' : ''} onClick={() => setSide('back')}>Back</button>
          </div>
          <button className="btn primary small" onClick={() => window.print()}>🖨 Print</button>
          <Link className="btn ghost small" to="/admin/credits">‹ Reception</Link>
        </div>
      </div>

      {(side === 'both' || side === 'front') && (
        <div className="pcard-sheet">
          <div className="pc-face">
            <div className="pc-glow" />
            <div className="pc-head">
              <div className="pc-brand">
                <span className="pc-leaf">🌿</span>
                <span className="pc-club">SATURDAY TRAINING<small>HERBALIFE NUTRITION CLUB</small></span>
              </div>
              <span className="pc-chip">MEMBER</span>
            </div>
            <div className="pc-id">
              {member.photoURL
                ? <img className="pc-photo" src={member.photoURL} alt="" crossOrigin="anonymous" />
                : <span className="pc-photo fb">{(member.name || '?')[0]}</span>}
              <div>
                <div className="pc-name">{member.name}</div>
                {member.position && <div className="pc-pos">{member.position}</div>}
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
              <span className="pc-tap">))) TAP TO ENTER</span>
            </div>
          </div>
        </div>
      )}

      {(side === 'both' || side === 'back') && (
        <div className="pcard-sheet">
          <div className="pc-face pc-back">
            <div className="pc-glow" />
            <div className="pc-bhead">))) TAP OR SCAN TO WALK IN</div>
            <div className="pc-bmid">
              <div className="pc-btext">
                <div className="pc-bname">{member.name}</div>
                <div className="pc-bsub">Member ID <b>{serial}</b></div>
                <div className="pc-fine">
                  <b>No money is stored on this card</b> — your balance is safe in your account. If found, please return to the club.
                </div>
              </div>
              <div className="pc-qr">
                <QRCodeCanvas value={member.memberToken || serial} size={280} level="M" includeMargin={false} />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
