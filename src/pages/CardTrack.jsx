import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { serverTimestamp } from 'firebase/firestore'
import { subscribeMembers, updateMemberProfile, assignCard, unassignCard } from '../lib/db'
import { useLocalReader } from '../lib/localReader'
import { useCardWedge } from '../lib/wedge'
import { normalizeCode } from '../lib/readerId'
import { feedback } from '../lib/feedback'
import ThemeToggle from '../components/ThemeToggle'

// Card Tracking — the handover register. Three counters per member:
//   PRINTED n/needed · ASSIGNED n/needed · GIVEN n/needed   (couples 👫 need 2)
// Plus "Assign cards" mode: tap a card on the reader and the app tells you who
// it belongs to — or asks who it should belong to. Card-first, not member-first.
const neededOf = (m) => (m.couple ? 2 : 1)
const printedOf = (m) => Math.min(neededOf(m), m.printedCount ?? (m.cardPrinted ? neededOf(m) : 0))
const givenOf = (m) => Math.min(neededOf(m), m.givenCount ?? (m.cardGiven ? neededOf(m) : 0))
const uidsOf = (m) => (m.cardUids || (m.cardUid ? [m.cardUid] : [])).filter(Boolean)
const assignedOf = (m) => Math.min(neededOf(m), uidsOf(m).length)

export default function CardTrack() {
  const [members, setMembers] = useState([])
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all') // all | print | assign | give | done
  const [assignMode, setAssignMode] = useState(false)
  useEffect(() => subscribeMembers(setMembers), [])

  const totals = useMemo(() => {
    const need = members.reduce((n, m) => n + neededOf(m), 0)
    return {
      need,
      printed: members.reduce((n, m) => n + printedOf(m), 0),
      assigned: members.reduce((n, m) => n + assignedOf(m), 0),
      given: members.reduce((n, m) => n + givenOf(m), 0),
      couples: members.filter((m) => m.couple).length,
    }
  }, [members])

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return members
      .filter((m) => !q || (m.name || '').toLowerCase().includes(q) || (m.mobile || '').includes(q))
      .filter((m) => {
        if (filter === 'print') return printedOf(m) < neededOf(m)
        if (filter === 'assign') return assignedOf(m) < neededOf(m)
        if (filter === 'give') return givenOf(m) < neededOf(m)
        if (filter === 'done') return givenOf(m) >= neededOf(m) && assignedOf(m) >= neededOf(m)
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
          <div className="muted small">Printed · Assigned · Given — couples 👫 need 2 of each</div>
        </div>
        <div className="row gap">
          <ThemeToggle />
          <button className="btn primary small" onClick={() => setAssignMode(true)}>💳 Assign cards</button>
          <Link className="btn ghost small" to="/admin/print">🖨 Card Studio</Link>
          <Link className="btn ghost small" to="/admin">‹ Reception</Link>
        </div>
      </header>

      <section className="mstats">
        <div className="mstat"><div className="mstat-val">{totals.need}</div><div className="mstat-lbl">Cards needed ({totals.couples} couples)</div></div>
        <div className="mstat"><div className="mstat-val">{totals.printed}</div><div className="mstat-lbl">Printed</div></div>
        <div className="mstat"><div className="mstat-val">{totals.assigned}</div><div className="mstat-lbl">Assigned</div></div>
        <div className="mstat"><div className="mstat-val">{totals.given}</div><div className="mstat-lbl">Given out</div></div>
      </section>

      <div className="row gap" style={{ margin: '4px 0 12px', flexWrap: 'wrap' }}>
        <input placeholder="Search name or mobile…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ flex: 1, minWidth: 200 }} />
        <div className="seg">
          {[['all', 'All'], ['print', 'To print'], ['assign', 'To assign'], ['give', 'To give'], ['done', 'Done ✓']].map(([k, l]) => (
            <button key={k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>{l}</button>
          ))}
        </div>
      </div>

      <div className="ctk-list">
        {rows.length === 0 && <div className="card"><div className="muted small">No members match.</div></div>}
        {rows.map((m) => {
          const need = neededOf(m)
          const p = printedOf(m), a = assignedOf(m), g = givenOf(m)
          const done = g >= need && a >= need
          return (
            <div key={m.id} className={`ctk-row ${m.couple ? 'couple' : ''} ${done ? 'done' : ''}`}>
              {m.photoURL ? <img className="ctk-face" src={m.photoURL} alt="" /> : <span className="ctk-face fb">{(m.name || '?')[0]}</span>}
              <div className="ctk-body">
                <div className={`ctk-name ${m.couple ? 'couplename' : ''}`}>{m.name}{m.couple ? ' 👫' : ''}</div>
                <div className="ctk-sub">
                  {m.tier || 'Associate'}{m.couple ? ' · COUPLE — 2 CARDS' : ''}{m.mobile ? ` · ${m.mobile}` : ''}
                  {uidsOf(m).length ? ` · card ${uidsOf(m).join(', ')}` : ''}
                  {done && m.givenAt?.seconds ? ` · given ${new Date(m.givenAt.seconds * 1000).toLocaleDateString([], { day: 'numeric', month: 'short' })}` : ''}
                </div>
              </div>
              <button className={`ctk-chip ${p >= need ? 'full' : p > 0 ? 'half' : ''}`} onClick={() => bump(m, 'print')}>
                🖨 PRINTED {p}/{need}
              </button>
              <span className={`ctk-chip assign ${a >= need ? 'full' : a > 0 ? 'half' : ''}`} title="Assign by tapping the card in Assign mode">
                💳 ASSIGNED {a}/{need}
              </span>
              <button className={`ctk-chip give ${g >= need ? 'full' : g > 0 ? 'half' : ''}`} onClick={() => bump(m, 'give')}>
                🤝 GIVEN {g}/{need}
              </button>
            </div>
          )
        })}
      </div>

      {assignMode && <AssignPanel members={members} onClose={() => setAssignMode(false)} />}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tap a card → the app says who it belongs to, or asks. Two jobs in one:
// assigning a stack of new cards, and TESTING cards you already wrote.
function AssignPanel({ members, onClose }) {
  const [uid, setUid] = useState('')          // the card currently on the reader
  const [q, setQ] = useState('')
  const [log, setLog] = useState([])          // what happened this session
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const membersRef = useRef([])
  const seen = useRef(new Map())
  const searchRef = useRef(null)
  useEffect(() => { membersRef.current = members }, [members])

  function onCard(code) {
    const c = normalizeCode(code)
    if (!c) return
    const now = Date.now()
    if (seen.current.get(c) && now - seen.current.get(c) < 1200) return // double-read
    seen.current.set(c, now)
    setUid(c)
    setQ('')
    setNote('')
    const owner = membersRef.current.find(
      (m) => m.cardUid === c || (m.cardUids || []).includes(c),
    )
    feedback(!!owner)
    if (!owner) setTimeout(() => searchRef.current?.focus(), 60)
  }
  useLocalReader(onCard)      // ACR122U via the bridge
  useCardWedge(onCard, true)  // keyboard-mode reader / QR gun

  const owner = uid ? members.find((m) => m.cardUid === uid || (m.cardUids || []).includes(uid)) : null
  const matches = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return []
    return members
      .filter((m) => (m.name || '').toLowerCase().includes(s) || (m.mobile || '').includes(s))
      .sort((a, b) => assignedOf(a) - assignedOf(b) || (a.name || '').localeCompare(b.name || ''))
      .slice(0, 6)
  }, [q, members])

  async function give(m) {
    if (!uid || busy) return
    setBusy(true)
    try {
      const r = await assignCard(m.id, uid, membersRef.current)
      feedback(true)
      setLog((l) => [{ uid, name: m.name, moved: r.movedFrom, at: Date.now() }, ...l].slice(0, 12))
      setNote(r.movedFrom ? `Moved from ${r.movedFrom}` : '')
      setUid(''); setQ('')
    } catch (e) {
      setNote(e.message)
    } finally { setBusy(false) }
  }
  async function release() {
    if (!owner) return
    await unassignCard(owner, uid)
    setLog((l) => [{ uid, name: `— removed from ${owner.name}`, at: Date.now() }, ...l].slice(0, 12))
    setUid('')
  }

  return (
    <div className="recharge-overlay" onClick={onClose}>
      <div className="recharge-panel assignp" onClick={(e) => e.stopPropagation()}>
        <div className="recharge-head">
          <div>
            <div className="recharge-name">💳 Assign cards</div>
            <div className="muted small">Tap a card on the reader — I'll tell you whose it is.</div>
          </div>
          <button className="btn ghost small" onClick={onClose}>✕</button>
        </div>

        {!uid && (
          <div className="asg-wait">
            <div className="asg-pulse">💳</div>
            <div className="asg-wait-t">Waiting for a card…</div>
            <div className="muted small">Place the next card on the reader. Bridge must be running.</div>
          </div>
        )}

        {uid && owner && (
          <div className="asg-known">
            <div className="asg-uid">CARD {uid}</div>
            {owner.photoURL
              ? <img className="asg-face" src={owner.photoURL} alt="" />
              : <span className="asg-face fb">{(owner.name || '?')[0]}</span>}
            <div className="asg-name">✓ {owner.name}{owner.couple ? ' 👫' : ''}</div>
            <div className="muted small">
              {owner.tier || 'Associate'} · {owner.credits || 0} credits ·
              {' '}card {assignedOf(owner)}/{neededOf(owner)} assigned
            </div>
            <div className="row gap" style={{ justifyContent: 'center', marginTop: 12 }}>
              <button className="btn small" onClick={() => { setUid(''); setQ('') }}>Next card ▶</button>
              <button className="btn small" onClick={() => { setQ(' '); setTimeout(() => searchRef.current?.focus(), 40) }}>Re-assign</button>
              <button className="btn small danger" onClick={release}>Remove</button>
            </div>
          </div>
        )}

        {uid && (!owner || q) && (
          <div className="asg-new">
            <div className="asg-uid">CARD {uid}</div>
            {!owner && <div className="asg-q">Who is this card for?</div>}
            <input
              ref={searchRef} autoFocus value={q.trimStart()}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Type a name…"
            />
            <div className="asg-matches">
              {matches.map((m) => (
                <button key={m.id} className="asg-match" disabled={busy} onClick={() => give(m)}>
                  {m.photoURL ? <img src={m.photoURL} alt="" /> : <span className="avatar-fallback sm">{(m.name || '?')[0]}</span>}
                  <span className="asg-match-name">
                    {m.name}{m.couple ? ' 👫' : ''}
                    <span className="muted small"> · {assignedOf(m)}/{neededOf(m)} cards</span>
                  </span>
                  <span className="asg-go">assign ›</span>
                </button>
              ))}
              {q.trim() && matches.length === 0 && <div className="muted small">No member matches “{q.trim()}”.</div>}
              {!q.trim() && <div className="muted small">Start typing — then click the name.</div>}
            </div>
          </div>
        )}

        {note && <div className="banner">{note}</div>}

        {log.length > 0 && (
          <div className="asg-log">
            <div className="muted small" style={{ marginBottom: 6 }}>This session</div>
            {log.map((l) => (
              <div key={l.at} className="asg-log-row">
                <b>{l.name}</b> <span className="muted small">{l.uid}{l.moved ? ` · moved from ${l.moved}` : ''}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
