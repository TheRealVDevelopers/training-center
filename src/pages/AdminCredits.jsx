import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CURRENCY, SESSION } from '../config'
import { useAuth } from '../auth/AuthContext'
import { subscribeMembers, addCredit, ensureMemberToken, assignCard, subscribeAccessCodes } from '../lib/db'
import { nfcSupported, writeNfc } from '../lib/nfc'
import { captureOneCard } from '../lib/wedge'
import { captureNextCard } from '../lib/localReader'

const FEE = SESSION.feePerPerson // ₹ per credit (one entry)

export default function AdminCredits() {
  const { isSuper } = useAuth()
  const [members, setMembers] = useState([])
  const [codes, setCodes] = useState({})
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(null)
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState('cash')
  const [ref, setRef] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [nfcMsg, setNfcMsg] = useState('')
  const [nfcBusy, setNfcBusy] = useState(false)
  const [findMsg, setFindMsg] = useState('')
  const [finding, setFinding] = useState(false)
  const [writePin, setWritePin] = useState('')

  useEffect(() => subscribeMembers(setMembers), [])
  useEffect(() => subscribeAccessCodes(setCodes), [])

  // Only the owner, or someone with the super-admin-generated Card Write PIN,
  // may assign/write a card. Adding credit needs no PIN.
  const writeUnlocked = isSuper || (!!codes.writeCode && writePin === codes.writeCode)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return members
    return members.filter(
      (m) => (m.name || '').toLowerCase().includes(q) || (m.mobile || '').includes(q),
    )
  }, [members, search])

  const sel = members.find((m) => m.id === selected) || null

  // Tap a member's own card to pull them up instantly — no searching.
  function tapToSelect() {
    setFindMsg('Tap the member’s card on the reader…')
    setFinding(true)
    document.activeElement?.blur()
    let cancelBridge
    let cancelKb
    let timer
    let done = false
    const finish = (code) => {
      if (done) return
      done = true
      if (cancelBridge) cancelBridge()
      if (cancelKb) cancelKb()
      clearTimeout(timer)
      setFinding(false)
      if (!code) { setFindMsg('Didn’t catch a card — click and tap again.'); return }
      const m = members.find((x) => x.cardUid === code || x.memberToken === code)
      if (!m) { setFindMsg(`Card ${code} isn’t assigned to anyone yet.`); return }
      setSelected(m.id)
      setFindMsg(`✓ ${m.name} · ${FEE ? Math.floor((m.balance || 0) / FEE) : 0} credits`)
    }
    cancelBridge = captureNextCard(finish)
    cancelKb = captureOneCard(finish)
    timer = setTimeout(() => finish(''), 25000)
  }

  async function submit(e) {
    e.preventDefault()
    setMsg('')
    const amt = Number(amount)
    if (!sel || !amt || amt <= 0) {
      setMsg('Pick a member and enter a positive amount.')
      return
    }
    setBusy(true)
    try {
      // Capture method + reference so a daily "cash collected vs credited" check is possible.
      const note = `Top-up · ${method}${ref ? ` · ${ref}` : ''}`
      await addCredit(sel.id, amt, note, { method, ref })
      setMsg(`Added ${CURRENCY}${amt} to ${sel.name}.`)
      setAmount('')
      setRef('')
    } catch (e) {
      setMsg(e.message)
    } finally {
      setBusy(false)
    }
  }

  async function issueCard() {
    if (!sel) return
    if (!writeUnlocked) { setNfcMsg('🔒 Enter the Card Write PIN first.'); return }
    setNfcMsg('Tap a blank card on the back of the phone…')
    setNfcBusy(true)
    try {
      const token = sel.memberToken || (await ensureMemberToken(sel))
      await writeNfc(token)
      setNfcMsg(`✓ Card issued to ${sel.name}. They can tap to enter.`)
    } catch (e) {
      setNfcMsg(e.message || 'Card write failed — hold the card still and retry.')
    } finally {
      setNfcBusy(false)
    }
  }

  function assignViaReader() {
    if (!sel) return
    if (!writeUnlocked) { setNfcMsg('🔒 Enter the Card Write PIN first.'); return }
    setNfcMsg('Tap the card on the reader now…')
    setNfcBusy(true)
    document.activeElement?.blur()

    let cancelBridge
    let cancelKb
    let timer
    let done = false
    const finish = async (uid) => {
      if (done) return
      done = true
      if (cancelBridge) cancelBridge()
      if (cancelKb) cancelKb()
      clearTimeout(timer)
      if (!uid) {
        setNfcMsg('Didn’t catch a card — click the button and tap again.')
        setNfcBusy(false)
        return
      }
      try {
        await assignCard(sel.id, uid)
        setNfcMsg(`✓ Card ${uid} assigned to ${sel.name}. They can tap to enter.`)
      } catch (e) {
        setNfcMsg(e.message)
      } finally {
        setNfcBusy(false)
      }
    }

    cancelBridge = captureNextCard(finish) // USB reader via the local bridge
    cancelKb = captureOneCard(finish) // keyboard-mode reader fallback
    timer = setTimeout(() => finish(''), 25000) // give up after 25s
  }

  return (
    <div className="page">
      <header className="topbar">
        <div className="brand"><span className="leaf">🌿</span>Admin · Credits</div>
        <Link className="btn ghost small" to="/admin">‹ Dashboard</Link>
      </header>

      <div className="card">
        <button className="btn primary block" onClick={tapToSelect} disabled={finding}>
          💳 {finding ? 'Tap the card now…' : 'Tap card to find member'}
        </button>
        {findMsg && <div className="banner" style={{ marginTop: 8 }}>{findMsg}</div>}
        <div className="muted small" style={{ margin: '12px 0 4px' }}>— or search —</div>
        <label>Search member (name or mobile)</label>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Type to filter…" />
        <div className="memberlist">
          {filtered.map((m) => (
            <button
              key={m.id}
              className={`memberrow ${selected === m.id ? 'sel' : ''}`}
              onClick={() => setSelected(m.id)}
            >
              <span>
                {m.photoURL ? <img className="avatar xs" src={m.photoURL} alt="" /> : <span className="avatar-fallback sm">{(m.name || '?')[0]}</span>}
                <span className="mname">{m.name}</span>
                <span className="muted small"> · {m.mobile}</span>
              </span>
              <span className="strong">{FEE ? Math.floor((m.balance || 0) / FEE) : 0} cr</span>
            </button>
          ))}
          {filtered.length === 0 && <div className="muted small">No members match.</div>}
        </div>
      </div>

      {sel && (
        <form className="card" onSubmit={submit}>
          <h3>Recharge · {sel.name}</h3>
          <div className="muted small">
            {sel.mobile ? `📞 ${sel.mobile} · ` : ''}
            <b>{FEE ? Math.floor((sel.balance || 0) / FEE) : 0} credits left</b> ({CURRENCY}{sel.balance || 0})
          </div>

          <button type="button" className="btn primary block" style={{ marginTop: 12 }} onClick={() => setAmount(String(5 * FEE))}>
            🎟️ Recharge 5 credits ({CURRENCY}{5 * FEE})
          </button>

          <label>Or another amount ({CURRENCY})</label>
          <div className="amt-presets">
            {[1, 5, 10].map((c) => (
              <button type="button" key={c} className={`amt-chip ${Number(amount) === c * FEE ? 'on' : ''}`} onClick={() => setAmount(String(c * FEE))}>
                {c} credit{c > 1 ? 's' : ''}
              </button>
            ))}
          </div>
          <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="numeric" placeholder="Custom ₹ amount" />

          <label>Payment method</label>
          <select value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="cash">Cash</option>
            <option value="upi">UPI</option>
          </select>

          <label>Reference (UPI ref / receipt no.)</label>
          <input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="optional but recommended" />

          {msg && <div className="banner">{msg}</div>}
          <button className="btn primary block" disabled={busy}>
            {busy ? 'Adding…' : `Add ${CURRENCY}${amount || 0}`}
          </button>
        </form>
      )}

      {sel && (
        <div className="card">
          <h3>Assign card · {sel.name}</h3>
          <div className="muted small" style={{ marginBottom: 10 }}>
            Links a card to this member. The card only stores their ID — never the balance — so recharges never touch the card.
          </div>
          {sel.cardUid && <div className="banner">Current card: <b>{sel.cardUid}</b></div>}

          {/* Printing the card needs no PIN — the QR is the identity */}
          <Link className="btn primary block" to={`/admin/print?m=${sel.id}`} target="_blank">
            🖨 Print card (Card Studio)
          </Link>

          {/* Assigning an NFC UID is write-restricted */}
          {!writeUnlocked ? (
            <div style={{ marginTop: 12 }}>
              <label>🔒 Card Write PIN (from Super Admin)</label>
              <input
                type="password" inputMode="numeric" maxLength={6}
                value={writePin} onChange={(e) => setWritePin(e.target.value.replace(/\D/g, ''))}
                placeholder={codes.writeCode ? 'Enter PIN to assign a card' : 'Owner must set a Write PIN first'}
              />
              {codes.writeCode && writePin.length === 6 && writePin !== codes.writeCode && (
                <div className="muted small" style={{ color: 'var(--danger)', marginTop: 6 }}>Incorrect PIN.</div>
              )}
            </div>
          ) : (
            <>
              <div className="banner" style={{ marginTop: 12 }}>✓ Card writing unlocked</div>
              <button className="btn block" onClick={assignViaReader} disabled={nfcBusy}>
                💳 {nfcBusy ? 'Tap the card now…' : 'Assign NFC card (USB reader)'}
              </button>
              {nfcSupported() && (
                <button className="btn block" onClick={issueCard} disabled={nfcBusy}>
                  📶 Write to card (phone NFC)
                </button>
              )}
            </>
          )}
          {nfcMsg && <div className="banner">{nfcMsg}</div>}
        </div>
      )}
    </div>
  )
}
