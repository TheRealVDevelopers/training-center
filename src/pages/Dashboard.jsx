import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { QRCodeCanvas } from 'qrcode.react'
import { useAuth } from '../auth/AuthContext'
import { useMemo } from 'react'
import { subscribeMemberHistory, ensureMemberToken } from '../lib/db'
import ThemeToggle from '../components/ThemeToggle'

// The member's page: their card, their credits, their pass. Nothing else.
export default function Dashboard() {
  const { member, logout, isSuper } = useAuth()
  const [history, setHistory] = useState([])
  const [showPass, setShowPass] = useState(false)
  const qrRef = useRef(null)

  useEffect(() => (member ? subscribeMemberHistory(member.id, setHistory) : undefined), [member])
  useEffect(() => {
    if (member && !member.memberToken) ensureMemberToken(member).catch(() => {})
  }, [member])

  const attended = useMemo(() => history.filter((t) => t.type === 'entry').length, [history])

  if (!member) return <div className="center muted">Loading your card…</div>
  const credits = member.credits || 0

  async function sharePass() {
    const c = qrRef.current?.querySelector('canvas')
    if (!c) return
    try {
      const blob = await new Promise((r) => c.toBlob(r, 'image/png'))
      const file = new File([blob], 'entry-pass.png', { type: 'image/png' })
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: 'My entry pass' })
        return
      }
    } catch { /* fall through */ }
    const a = document.createElement('a')
    a.href = c.toDataURL('image/png')
    a.download = 'entry-pass.png'
    a.click()
  }

  return (
    <div className="page">
      <header className="topbar">
        <div>
          <div className="brand"><span className="leaf">🌿</span>Saturday Training</div>
          <div className="muted small">Walk in · tap · train</div>
        </div>
        <div className="row gap">
          <ThemeToggle />
          {isSuper && <Link className="btn ghost small" to="/owner">Owner</Link>}
          <Link className="btn ghost small" to="/profile">👤</Link>
          <button className="btn ghost small" onClick={logout}>Log out</button>
        </div>
      </header>

      {/* The card */}
      <section className="hero memcard">
        <div className="memcard-top">
          <div className="memcard-id">
            {member.photoURL
              ? <img src={member.photoURL} alt="" />
              : <span className="avatar-fallback">{(member.name || '?')[0]}</span>}
            <div>
              <div className="memcard-name">{member.name}{member.couple ? ' 👫' : ''}</div>
              <div className="memcard-role">{member.tier || 'Member'}{member.clubName ? ` · ${member.clubName}` : ''}</div>
            </div>
          </div>
          <span className="memcard-chip">MEMBER</span>
        </div>
        <div>
          <div className="muted small">Entries left</div>
          <div className="balance">{credits}</div>
        </div>
        <div className="memcard-facts">
          <div><span className="f-val">{attended}</span><span className="f-lbl">attended</span></div>
          <div><span className="f-val">{member.couple ? '2' : '1'}</span><span className="f-lbl">cards</span></div>
          <div><span className="f-val">{(member.id || '').slice(-4).toUpperCase()}</span><span className="f-lbl">member no.</span></div>
        </div>
      </section>

      <button className="btn primary block big-cta" onClick={() => setShowPass(true)} disabled={!member.memberToken}>
        🎟️ Show my pass
      </button>
      {credits < 1 && (
        <div className="topup-note"><span>💳</span> No entries left — recharge at the desk on Saturday and you're in.</div>
      )}

      {/* History */}
      <div className="card">
        <div className="row between"><h3 style={{ margin: 0 }}>Activity</h3><span className="muted small">{history.length}</span></div>
        {history.length === 0 ? (
          <div className="empty"><span className="ico">🎟️</span><div className="t">Nothing yet</div><div className="small">Entries and recharges show here.</div></div>
        ) : (
          <div style={{ marginTop: 12 }}>
            {history.slice(0, 30).map((t) => (
              <div key={t.id} className="hist-row">
                <span className={`hist-ico ${(t.credits || t.amount) > 0 ? 'in' : 'out'}`}>{t.type === 'entry' ? '🎟️' : '💳'}</span>
                <div className="hist-body">
                  <div className="hist-title">{t.note || t.type}</div>
                  <div className="muted small">{fmtDate(t.createdAt)}</div>
                </div>
                <div className={`hist-amt ${(t.credits ?? t.amount) >= 0 ? 'pos' : 'neg'}`}>
                  {t.credits != null
                    ? `${t.credits > 0 ? '+' : ''}${t.credits} cr`
                    : `${t.amount >= 0 ? '+' : '−'}₹${Math.abs(t.amount)}`}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Pass overlay */}
      {showPass && member.memberToken && (
        <div className="recharge-overlay" onClick={() => setShowPass(false)}>
          <div className="recharge-panel center-text" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>Your entry pass</h3>
            <div className="qrwrap" ref={qrRef}>
              <QRCodeCanvas value={member.memberToken} size={480} level="M" includeMargin style={{ width: 240, height: 240 }} />
            </div>
            <p className="muted small">Show this at the desk — it's yours forever. Got the tap card? Just tap instead.</p>
            <div className="row gap" style={{ justifyContent: 'center' }}>
              <button className="btn small" onClick={sharePass}>📤 Save / share</button>
              <button className="btn small ghost" onClick={() => setShowPass(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function fmtDate(ts) {
  if (!ts?.seconds) return 'just now'
  const d = new Date(ts.seconds * 1000)
  return `${d.toLocaleDateString([], { day: 'numeric', month: 'short' })} · ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
}
