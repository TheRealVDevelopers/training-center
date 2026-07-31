import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { serverTimestamp } from 'firebase/firestore'
import { subscribeMembers, updateMemberProfile } from '../lib/db'
import ThemeToggle from '../components/ThemeToggle'

// Card Tracking — the full-screen handover register. Every member, big rows:
//   PRINTED n/needed  ·  GIVEN n/needed   (couples 👫 need 2 of each)
// Tap a chip to advance the count; when GIVEN completes, the date is recorded.
const neededOf = (m) => (m.couple ? 2 : 1)
const printedOf = (m) => Math.min(neededOf(m), m.printedCount ?? (m.cardPrinted ? neededOf(m) : 0))
const givenOf = (m) => Math.min(neededOf(m), m.givenCount ?? (m.cardGiven ? neededOf(m) : 0))

export default function CardTrack() {
  const [members, setMembers] = useState([])
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all') // all | print | give | done
  useEffect(() => subscribeMembers(setMembers), [])

  const totals = useMemo(() => {
    const need = members.reduce((n, m) => n + neededOf(m), 0)
    const printed = members.reduce((n, m) => n + printedOf(m), 0)
    const given = members.reduce((n, m) => n + givenOf(m), 0)
    return { need, printed, given, couples: members.filter((m) => m.couple).length }
  }, [members])

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return members
      .filter((m) => !q || (m.name || '').toLowerCase().includes(q) || (m.mobile || '').includes(q))
      .filter((m) => {
        if (filter === 'print') return printedOf(m) < neededOf(m)
        if (filter === 'give') return printedOf(m) >= neededOf(m) && givenOf(m) < neededOf(m)
        if (filter === 'done') return givenOf(m) >= neededOf(m)
        return true
      })
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
  }, [members, search, filter])

  function bump(m, kind) {
    const needed = neededOf(m)
    const cur = kind === 'print' ? printedOf(m) : givenOf(m)
    const next = (cur + 1) % (needed + 1) // taps cycle 0 → 1 → (2) → 0
    const patch = kind === 'print'
      ? { printedCount: next, cardPrinted: next >= needed }
      : { givenCount: next, cardGiven: next >= needed, givenAt: next >= needed ? serverTimestamp() : null }
    updateMemberProfile(m.id, patch).catch(() => {})
  }

  return (
    <div className="page wide ctk">
      <header className="topbar">
        <div>
          <div className="brand"><span className="leaf">🌿</span>Card Tracking</div>
          <div className="muted small">Tap PRINTED / GIVEN to advance — couples 👫 need 2 of each</div>
        </div>
        <div className="row gap">
          <ThemeToggle />
          <Link className="btn ghost small" to="/admin/print">🖨 Card Studio</Link>
          <Link className="btn ghost small" to="/admin">‹ Reception</Link>
        </div>
      </header>

      <section className="mstats">
        <div className="mstat"><div className="mstat-val">{totals.need}</div><div className="mstat-lbl">Cards needed ({totals.couples} couples)</div></div>
        <div className="mstat"><div className="mstat-val">{totals.printed}</div><div className="mstat-lbl">Printed</div></div>
        <div className="mstat"><div className="mstat-val">{totals.given}</div><div className="mstat-lbl">Given out</div></div>
      </section>

      <div className="row gap" style={{ margin: '4px 0 12px', flexWrap: 'wrap' }}>
        <input placeholder="Search name or mobile…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ flex: 1, minWidth: 200 }} />
        <div className="seg">
          {[['all', 'All'], ['print', 'To print'], ['give', 'To give'], ['done', 'Done ✓']].map(([k, l]) => (
            <button key={k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>{l}</button>
          ))}
        </div>
      </div>

      <div className="ctk-list">
        {rows.length === 0 && <div className="card"><div className="muted small">No members match.</div></div>}
        {rows.map((m) => {
          const need = neededOf(m)
          const p = printedOf(m)
          const g = givenOf(m)
          const done = g >= need
          return (
            <div key={m.id} className={`ctk-row ${m.couple ? 'couple' : ''} ${done ? 'done' : ''}`}>
              {m.photoURL ? <img className="ctk-face" src={m.photoURL} alt="" /> : <span className="ctk-face fb">{(m.name || '?')[0]}</span>}
              <div className="ctk-body">
                <div className={`ctk-name ${m.couple ? 'couplename' : ''}`}>{m.name}{m.couple ? ' 👫' : ''}</div>
                <div className="ctk-sub">
                  {m.tier || 'Associate'}{m.couple ? ' · COUPLE — 2 CARDS' : ''}{m.mobile ? ` · ${m.mobile}` : ''}
                  {done && m.givenAt?.seconds ? ` · given ${new Date(m.givenAt.seconds * 1000).toLocaleDateString([], { day: 'numeric', month: 'short' })}` : ''}
                </div>
              </div>
              <button className={`ctk-chip ${p >= need ? 'full' : p > 0 ? 'half' : ''}`} onClick={() => bump(m, 'print')}>
                🖨 PRINTED {p}/{need}
              </button>
              <button className={`ctk-chip give ${g >= need ? 'full' : g > 0 ? 'half' : ''}`} onClick={() => bump(m, 'give')}>
                🤝 GIVEN {g}/{need}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
