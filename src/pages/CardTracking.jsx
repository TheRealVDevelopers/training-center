import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { subscribeMembers, updateMemberProfile } from '../lib/db'

// Card fulfilment tracker. For every member: is their card PRINTED, and has it
// been GIVEN to them? Plus a "couple" toggle → that account needs 2 cards.
// Owner ticks these off as they go; the counts show what's left.
export default function CardTracking() {
  const [members, setMembers] = useState([])
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all') // all | toprint | togive | done
  const [busy, setBusy] = useState('')

  useEffect(() => subscribeMembers(setMembers), [])

  async function toggle(m, field) {
    setBusy(`${m.id}:${field}`)
    try { await updateMemberProfile(m.id, { [field]: !m[field] }) } finally { setBusy('') }
  }

  const stats = useMemo(() => {
    let cardsNeeded = 0, printed = 0, given = 0, couples = 0
    for (const m of members) {
      const n = m.couple ? 2 : 1
      cardsNeeded += n
      if (m.couple) couples++
      if (m.cardPrinted) printed += n
      if (m.cardGiven) given += n
    }
    return { total: members.length, couples, cardsNeeded, printed, given }
  }, [members])

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    return members
      .filter((m) => !q || (m.name || '').toLowerCase().includes(q) || (m.mobile || '').includes(q))
      .filter((m) => {
        if (filter === 'toprint') return !m.cardPrinted
        if (filter === 'togive') return m.cardPrinted && !m.cardGiven
        if (filter === 'done') return m.cardGiven
        return true
      })
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
  }, [members, search, filter])

  return (
    <div className="page wide">
      <header className="topbar">
        <div>
          <div className="brand"><span className="leaf">🌿</span>Card tracking</div>
          <div className="muted small">Who's printed · who's got their card</div>
        </div>
        <Link className="btn ghost small" to="/admin">‹ Reception</Link>
      </header>

      <section className="mstats">
        <div className="mstat"><div className="mstat-val">{stats.total}</div><div className="mstat-lbl">Members</div></div>
        <div className="mstat"><div className="mstat-val">{stats.cardsNeeded}</div><div className="mstat-lbl">Cards needed ({stats.couples} couples)</div></div>
        <div className="mstat"><div className="mstat-val">{stats.printed}</div><div className="mstat-lbl">Printed</div></div>
        <div className="mstat"><div className="mstat-val">{stats.given}</div><div className="mstat-lbl">Given</div></div>
      </section>

      <div className="card">
        <div className="row between" style={{ flexWrap: 'wrap', gap: 10 }}>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name or mobile…" style={{ flex: 1, minWidth: 180 }} />
          <div className="chipset">
            {[['all', 'All'], ['toprint', 'To print'], ['togive', 'To give'], ['done', 'Given']].map(([k, label]) => (
              <button key={k} className={`chip ${filter === k ? 'on' : ''}`} onClick={() => setFilter(k)}>{label}</button>
            ))}
          </div>
        </div>

        <div className="cardtrack-list">
          {shown.map((m) => (
            <div key={m.id} className="cardtrack-row">
              {m.photoURL ? <img className="avatar xs" src={m.photoURL} alt="" /> : <span className="avatar-fallback sm">{(m.name || '?')[0]}</span>}
              <div className="cardtrack-who">
                <div className="cardtrack-name">{m.name}{m.couple ? ' 👫' : ''}</div>
                <div className="muted small">{m.tier || 'no tier'}{m.mobile ? ` · ${m.mobile}` : ''}</div>
              </div>
              <button
                className={`ct-toggle ${m.couple ? 'on couple' : ''}`}
                disabled={busy === `${m.id}:couple`}
                onClick={() => toggle(m, 'couple')}
                title="Couple → needs 2 cards"
              >
                {m.couple ? '×2 couple' : '×1'}
              </button>
              <button
                className={`ct-toggle ${m.cardPrinted ? 'on printed' : ''}`}
                disabled={busy === `${m.id}:cardPrinted`}
                onClick={() => toggle(m, 'cardPrinted')}
              >
                {m.cardPrinted ? '✓ Printed' : 'Printed?'}
              </button>
              <button
                className={`ct-toggle ${m.cardGiven ? 'on given' : ''}`}
                disabled={busy === `${m.id}:cardGiven`}
                onClick={() => toggle(m, 'cardGiven')}
              >
                {m.cardGiven ? '✓ Given' : 'Given?'}
              </button>
            </div>
          ))}
          {shown.length === 0 && <div className="muted small" style={{ padding: 20 }}>No members match.</div>}
        </div>
      </div>
    </div>
  )
}
