import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { subscribeMembers, subscribeSessions, subscribeEntriesBetween } from '../lib/db'
import { eligibleSessions } from '../lib/attendance'
import { exportCsv } from '../lib/exportCsv'
import ThemeToggle from '../components/ThemeToggle'

// F7 — the whole club on one screen. Members down, Saturdays across.
//   ✓ came · · missed · blank = not a member yet
// Grey (not red) for a miss: this gets printed and passed around, and colour
// alone should never read as blame.
const WINDOW = 12 // Saturdays shown by default

export default function Matrix() {
  const [members, setMembers] = useState([])
  const [sessions, setSessions] = useState([])
  const [entries, setEntries] = useState([])
  const [sort, setSort] = useState('pct') // pct | name | visits
  const [search, setSearch] = useState('')

  useEffect(() => subscribeMembers(setMembers), [])
  useEffect(() => subscribeSessions(setSessions, 60), [])

  const cols = useMemo(
    () => sessions
      .filter((s) => s.status !== 'cancelled')
      .sort((a, b) => (a.date || a.id).localeCompare(b.date || b.id))
      .slice(-WINDOW),
    [sessions],
  )
  const from = cols[0]?.date || cols[0]?.id || '0000-01-01'
  useEffect(() => subscribeEntriesBetween(from, '9999-12-31', setEntries), [from])

  const attendedSet = useMemo(
    () => new Set(entries.map((e) => `${e.memberId}|${e.sessionId}`)),
    [entries],
  )

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    const out = members
      .filter((m) => !q || (m.name || '').toLowerCase().includes(q) || (m.mobile || '').includes(q))
      .map((m) => {
        const elig = new Set(eligibleSessions(m, cols).map((s) => s.id))
        const cells = cols.map((s) => {
          if (!elig.has(s.id)) return 'na'
          return attendedSet.has(`${m.id}|${s.id}`) ? 'in' : 'out'
        })
        const visits = cells.filter((c) => c === 'in').length
        const total = cells.filter((c) => c !== 'na').length
        return { m, cells, visits, total, pct: total ? Math.round((visits / total) * 100) : null }
      })
    if (sort === 'name') out.sort((a, b) => (a.m.name || '').localeCompare(b.m.name || ''))
    else if (sort === 'visits') out.sort((a, b) => b.visits - a.visits)
    else out.sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1) || b.visits - a.visits)
    return out
  }, [members, cols, attendedSet, sort, search])

  function download() {
    const head = ['Member', 'Level', ...cols.map((s) => s.date || s.id), 'Visits', 'Of', 'Attendance %']
    const body = rows.map((r) => [
      r.m.name, r.m.tier || 'Associate',
      ...r.cells.map((c) => (c === 'in' ? 'present' : c === 'out' ? 'absent' : '')),
      r.visits, r.total, r.pct ?? '',
    ])
    exportCsv(`attendance-matrix-${new Date().toISOString().slice(0, 10)}`, [head, ...body])
  }

  return (
    <div className="page wide">
      <header className="topbar no-print">
        <div>
          <div className="brand"><span className="leaf">🌿</span>Attendance</div>
          <div className="muted small">Last {cols.length} Saturday{cols.length === 1 ? '' : 's'} · ✓ came · · missed</div>
        </div>
        <div className="row gap">
          <ThemeToggle />
          <button className="btn ghost small" onClick={() => window.print()}>🖨 Print</button>
          <button className="btn ghost small" onClick={download}>⬇ CSV</button>
          <Link className="btn ghost small" to="/owner">‹ Owner</Link>
        </div>
      </header>

      <div className="print-title">🌿 Attendance — last {cols.length} Saturdays</div>

      <div className="row gap no-print" style={{ margin: '4px 0 12px', flexWrap: 'wrap' }}>
        <input placeholder="Search member…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ flex: 1, minWidth: 180 }} />
        <div className="seg">
          {[['pct', 'By attendance'], ['visits', 'By visits'], ['name', 'A–Z']].map(([k, l]) => (
            <button key={k} className={sort === k ? 'on' : ''} onClick={() => setSort(k)}>{l}</button>
          ))}
        </div>
      </div>

      {cols.length === 0 ? (
        <div className="card"><div className="muted small">No Saturdays recorded yet — the grid fills in as sessions happen.</div></div>
      ) : (
        <div className="card mx-card">
          <div className="mx-wrap">
            <table className="mx">
              <thead>
                <tr>
                  <th className="mx-name">Member</th>
                  {cols.map((s) => {
                    const d = (s.date || s.id).slice(5)
                    return <th key={s.id} className="mx-col" title={s.date || s.id}>
                      <Link to={`/owner/session/${s.id}`}>{d.replace('-', '/')}</Link>
                    </th>
                  })}
                  <th className="mx-pct">%</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.m.id}>
                    <td className="mx-name">
                      <Link to={`/owner/member/${r.m.id}`}>{r.m.name}</Link>{r.m.couple ? ' 👫' : ''}
                    </td>
                    {r.cells.map((c, i) => (
                      <td key={cols[i].id} className={`mx-cell ${c}`}>
                        {c === 'in' ? <Link to={`/owner/member/${r.m.id}`}>✓</Link> : c === 'out' ? '·' : ''}
                      </td>
                    ))}
                    <td className="mx-pct">{r.pct == null ? '—' : `${r.pct}%`}</td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td className="muted" colSpan={cols.length + 2}>No members match.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="muted small" style={{ marginTop: 10 }}>
            Blank = they had not joined yet, so it never counts against them.
          </div>
        </div>
      )}
    </div>
  )
}
