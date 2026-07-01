import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CURRENCY } from '../config'
import { subscribeMembers, addCredit } from '../lib/db'

export default function AdminCredits() {
  const [members, setMembers] = useState([])
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(null)
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState('cash')
  const [ref, setRef] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

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
    </div>
  )
}
