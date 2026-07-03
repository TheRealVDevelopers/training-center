import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CURRENCY } from '../config'
import { subscribeMembers, addCredit, ensureMemberToken, assignCard } from '../lib/db'
import { nfcSupported, writeNfc } from '../lib/nfc'
import { captureOneCard } from '../lib/wedge'

export default function AdminCredits() {
  const [members, setMembers] = useState([])
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(null)
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState('cash')
  const [ref, setRef] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [nfcMsg, setNfcMsg] = useState('')
  const [nfcBusy, setNfcBusy] = useState(false)

  useEffect(() => subscribeMembers(setMembers), [])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return members
    return members.filter(
      (m) => (m.name || '').toLowerCase().includes(q) || (m.mobile || '').includes(q),
    )
  }, [members, search])

  const sel = members.find((m) => m.id === selected) || null

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
      await addCredit(sel.id, amt, note)
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
    setNfcMsg('Tap the card on the USB reader now…')
    setNfcBusy(true)
    document.activeElement?.blur()
    captureOneCard(async (uid) => {
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
    })
  }

  return (
    <div className="page">
      <header className="topbar">
        <div className="brand"><span className="leaf">🌿</span>Admin · Credits</div>
        <Link className="btn ghost small" to="/admin">‹ Dashboard</Link>
      </header>

      <div className="card">
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
              <span className="strong">{CURRENCY}{m.balance || 0}</span>
            </button>
          ))}
          {filtered.length === 0 && <div className="muted small">No members match.</div>}
        </div>
      </div>

      {sel && (
        <form className="card" onSubmit={submit}>
          <h3>Add credit · {sel.name}</h3>
          <div className="muted small">Current balance: {CURRENCY}{sel.balance || 0}</div>

          <label>Amount ({CURRENCY})</label>
          <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="numeric" />

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
            Give this member a card to tap at the door. The card only stores their ID — never the balance — so recharges never touch the card.
          </div>
          {sel.cardUid && <div className="banner">Current card: <b>{sel.cardUid}</b></div>}
          <button className="btn primary block" onClick={assignViaReader} disabled={nfcBusy}>
            💳 {nfcBusy ? 'Tap the card now…' : 'Assign card (USB reader)'}
          </button>
          {nfcSupported() && (
            <button className="btn block" onClick={issueCard} disabled={nfcBusy}>
              📶 Write card (phone NFC)
            </button>
          )}
          {nfcMsg && <div className="banner">{nfcMsg}</div>}
        </div>
      )}
    </div>
  )
}
