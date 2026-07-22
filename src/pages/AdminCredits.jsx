import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CURRENCY, SESSION, PACK_CREDITS, TIERS, packPrice, pricePerCredit } from '../config'
import { useAuth } from '../auth/AuthContext'
import {
  subscribeMembers, ensureMemberToken, assignCard, subscribeAccessCodes,
  rechargePacks, linkCouple, unlinkCouple, updateMemberProfile,
} from '../lib/db'
import { nfcSupported, writeNfc } from '../lib/nfc'
import { captureOneCard } from '../lib/wedge'
import { captureNextCard } from '../lib/localReader'

export default function AdminCredits() {
  const { isSuper } = useAuth()
  const [members, setMembers] = useState([])
  const [codes, setCodes] = useState({})
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(null)
  const [packs, setPacks] = useState(1)
  const [method, setMethod] = useState('cash')
  const [ref, setRef] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [nfcMsg, setNfcMsg] = useState('')
  const [nfcBusy, setNfcBusy] = useState(false)
  const [findMsg, setFindMsg] = useState('')
  const [finding, setFinding] = useState(false)
  const [writePin, setWritePin] = useState('')
  const [manualUid, setManualUid] = useState('')
  const [partnerSearch, setPartnerSearch] = useState('')

  useEffect(() => subscribeMembers(setMembers), [])
  useEffect(() => subscribeAccessCodes(setCodes), [])

  const writeUnlocked = isSuper || (!!codes.writeCode && writePin === codes.writeCode)
  const byId = useMemo(() => Object.fromEntries(members.map((m) => [m.id, m])), [members])

  // Credits are shared by a couple: resolve the wallet owner, price by its tier.
  const ownerOf = (m) => (m && m.walletOwnerId && byId[m.walletOwnerId]) || m
  const perCredit = (m) => { const o = ownerOf(m); return o?.tier ? pricePerCredit(o.tier) : SESSION.feePerPerson }
  const creditsOf = (m) => { const o = ownerOf(m); return Math.floor((o?.balance || 0) / perCredit(m)) }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return members
    return members.filter((m) => (m.name || '').toLowerCase().includes(q) || (m.mobile || '').includes(q))
  }, [members, search])

  const sel = members.find((m) => m.id === selected) || null
  const partner = sel?.partnerId ? byId[sel.partnerId] : null

  function tapToSelect() {
    setFindMsg('Tap the member’s card on the reader…')
    setFinding(true)
    document.activeElement?.blur()
    let cancelBridge, cancelKb, timer, done = false
    const finish = (code) => {
      if (done) return
      done = true
      cancelBridge?.(); cancelKb?.(); clearTimeout(timer); setFinding(false)
      if (!code) { setFindMsg('Didn’t catch a card — click and tap again.'); return }
      const m = members.find((x) => x.cardUid === code || x.memberToken === code)
      if (!m) { setFindMsg(`Card ${code} isn’t assigned to anyone yet.`); return }
      setSelected(m.id)
      setFindMsg(`✓ ${m.name} · ${creditsOf(m)} credits`)
    }
    cancelBridge = captureNextCard(finish)
    cancelKb = captureOneCard(finish)
    timer = setTimeout(() => finish(''), 25000)
  }

  const perPack = sel ? (ownerOf(sel).tier ? packPrice(ownerOf(sel).tier) : SESSION.feePerPerson * PACK_CREDITS) : 0
  const rechargeAmount = perPack * packs
  const rechargeCredits = PACK_CREDITS * packs

  async function recharge(e) {
    e.preventDefault()
    setMsg('')
    if (!sel) { setMsg('Pick a member first.'); return }
    setBusy(true)
    try {
      const r = await rechargePacks(sel.id, packs, { method, ref, sessionFee: SESSION.feePerPerson, note: `Recharge · ${rechargeCredits} credits · ${method}${ref ? ` · ${ref}` : ''}` })
      setMsg(`Added ${r.credits} credits (${CURRENCY}${r.amount}) to ${sel.name}.`)
      setRef('')
    } catch (e) {
      setMsg(e.message)
    } finally {
      setBusy(false)
    }
  }

  async function setTier(tier) {
    if (!sel) return
    try { await updateMemberProfile(sel.id, { tier }) } catch (e) { setMsg(e.message) }
  }
  async function link(partnerId) {
    if (!sel) return
    try { await linkCouple(sel.id, partnerId); setPartnerSearch('') } catch (e) { setMsg(e.message) }
  }
  async function unlink() {
    if (!sel) return
    try { await unlinkCouple(sel.id) } catch (e) { setMsg(e.message) }
  }

  async function issueCard() {
    if (!sel) return
    if (!writeUnlocked) { setNfcMsg('🔒 Enter the Card Write PIN first.'); return }
    setNfcMsg('Tap a blank card on the back of the phone…'); setNfcBusy(true)
    try {
      const token = sel.memberToken || (await ensureMemberToken(sel))
      await writeNfc(token)
      setNfcMsg(`✓ Card issued to ${sel.name}. They can tap to enter.`)
    } catch (e) { setNfcMsg(e.message || 'Card write failed — hold the card still and retry.') }
    finally { setNfcBusy(false) }
  }
  async function assignManual() {
    if (!sel) return
    if (!writeUnlocked) { setNfcMsg('🔒 Enter the Card Write PIN first.'); return }
    const code = manualUid.trim()
    if (!code) { setNfcMsg('Scan or type the card ID first.'); return }
    setNfcBusy(true)
    try { await assignCard(sel.id, code); setNfcMsg(`✓ Card ${code} assigned to ${sel.name}.`); setManualUid('') }
    catch (e) { setNfcMsg(e.message) } finally { setNfcBusy(false) }
  }
  function assignViaReader() {
    if (!sel) return
    if (!writeUnlocked) { setNfcMsg('🔒 Enter the Card Write PIN first.'); return }
    setNfcMsg('Tap the card on the reader now…'); setNfcBusy(true)
    document.activeElement?.blur()
    let cancelBridge, cancelKb, timer, done = false
    const finish = async (uid) => {
      if (done) return
      done = true
      cancelBridge?.(); cancelKb?.(); clearTimeout(timer)
      if (!uid) { setNfcMsg('Didn’t catch a card — click the button and tap again.'); setNfcBusy(false); return }
      try { await assignCard(sel.id, uid); setNfcMsg(`✓ Card ${uid} assigned to ${sel.name}.`) }
      catch (e) { setNfcMsg(e.message) } finally { setNfcBusy(false) }
    }
    cancelBridge = captureNextCard(finish)
    cancelKb = captureOneCard(finish)
    timer = setTimeout(() => finish(''), 25000)
  }

  const partnerMatches = useMemo(() => {
    const q = partnerSearch.trim().toLowerCase()
    if (!q || !sel) return []
    return members
      .filter((m) => m.id !== sel.id && !m.partnerId && ((m.name || '').toLowerCase().includes(q) || (m.mobile || '').includes(q)))
      .slice(0, 6)
  }, [partnerSearch, members, sel])

  return (
    <div className="page">
      <header className="topbar">
        <div className="brand"><span className="leaf">🌿</span>Credits &amp; cards</div>
        <Link className="btn ghost small" to="/admin">‹ Reception</Link>
      </header>

      <div className="card">
        <button className="btn primary block" onClick={tapToSelect} disabled={finding}>
          💳 {finding ? 'Tap the card now…' : 'Tap card to find member'}
        </button>
        {findMsg && <div className="banner" style={{ marginTop: 8 }}>{findMsg}</div>}
        <div className="muted small" style={{ margin: '12px 0 4px' }}>— or search —</div>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Type name or mobile…" />
        <div className="memberlist">
          {filtered.map((m) => (
            <button key={m.id} className={`memberrow ${selected === m.id ? 'sel' : ''}`} onClick={() => setSelected(m.id)}>
              <span>
                {m.photoURL ? <img className="avatar xs" src={m.photoURL} alt="" /> : <span className="avatar-fallback sm">{(m.name || '?')[0]}</span>}
                <span className="mname">{m.name}</span>
                <span className="muted small"> · {m.tier || 'no tier'}{m.partnerId ? ' · 💑' : ''}</span>
              </span>
              <span className="strong">{creditsOf(m)} cr</span>
            </button>
          ))}
          {filtered.length === 0 && <div className="muted small">No members match.</div>}
        </div>
      </div>

      {sel && (
        <>
          <form className="card" onSubmit={recharge}>
            <h3>Recharge · {sel.name}</h3>
            <div className="muted small">
              {sel.mobile ? `📞 ${sel.mobile} · ` : ''}
              <b>{creditsOf(sel)} credits left</b>
              {sel.partnerId ? ` · shared with ${byId[sel.partnerId]?.name || 'partner'}` : ''}
            </div>

            <label>Tier (sets the price)</label>
            <select value={sel.tier || ''} onChange={(e) => setTier(e.target.value)}>
              <option value="">— no tier (₹{SESSION.feePerPerson}/credit) —</option>
              {Object.keys(TIERS).map((t) => <option key={t} value={t}>{t} · {CURRENCY}{TIERS[t]}/{PACK_CREDITS}</option>)}
            </select>

            <label>Packs to add ({PACK_CREDITS} credits each)</label>
            <div className="amt-presets">
              {[1, 2, 3].map((p) => (
                <button type="button" key={p} className={`amt-chip ${packs === p ? 'on' : ''}`} onClick={() => setPacks(p)}>
                  {p * PACK_CREDITS} credits
                </button>
              ))}
            </div>
            <div className="recharge-amt" style={{ fontSize: 22 }}>{CURRENCY}{rechargeAmount} <span className="muted small">· {rechargeCredits} entries</span></div>

            <label>Payment method</label>
            <select value={method} onChange={(e) => setMethod(e.target.value)}>
              <option value="cash">Cash</option>
              <option value="upi">UPI</option>
            </select>
            <label>Reference (UPI ref / receipt no.)</label>
            <input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="optional but recommended" />

            {msg && <div className="banner">{msg}</div>}
            <button className="btn primary block" disabled={busy}>
              {busy ? 'Adding…' : `Recharge ${rechargeCredits} credits · ${CURRENCY}${rechargeAmount}`}
            </button>
          </form>

          <div className="card">
            <h3>Couple · {sel.name}</h3>
            {partner ? (
              <>
                <div className="banner">💑 Linked with <b>{partner.name}</b> — they share one wallet ({creditsOf(sel)} credits).</div>
                <button className="btn block" onClick={unlink} style={{ marginTop: 10 }}>Unlink couple</button>
              </>
            ) : (
              <>
                <div className="muted small" style={{ marginBottom: 8 }}>
                  Link a spouse so both cards share one credit pool (charged once per session).
                </div>
                <input value={partnerSearch} onChange={(e) => setPartnerSearch(e.target.value)} placeholder="Search partner by name / mobile…" />
                <div className="manual-list">
                  {partnerMatches.map((m) => (
                    <button key={m.id} className="manual-row" onClick={() => link(m.id)}>
                      {m.photoURL ? <img src={m.photoURL} alt="" /> : <span className="avatar-fallback sm">{(m.name || '?')[0]}</span>}
                      <span className="manual-name">{m.name}<span className="muted small"> · {m.mobile}</span></span>
                    </button>
                  ))}
                  {partnerSearch && partnerMatches.length === 0 && <div className="muted small">No unlinked member matches.</div>}
                </div>
              </>
            )}
          </div>

          <div className="card">
            <h3>Assign card · {sel.name}</h3>
            <div className="muted small" style={{ marginBottom: 10 }}>
              Links a card to this member. The card only stores their ID — never the balance — so recharges never touch the card.
            </div>
            {sel.cardUid && <div className="banner">Current card: <b>{sel.cardUid}</b></div>}
            {!writeUnlocked ? (
              <div>
                <label>🔒 Card Write PIN (from Super Admin)</label>
                <input type="password" inputMode="numeric" maxLength={6} value={writePin}
                  onChange={(e) => setWritePin(e.target.value.replace(/\D/g, ''))}
                  placeholder={codes.writeCode ? 'Enter PIN to assign a card' : 'Owner must set a Write PIN first'} />
                {codes.writeCode && writePin.length === 6 && writePin !== codes.writeCode && (
                  <div className="muted small" style={{ color: 'var(--danger)', marginTop: 6 }}>Incorrect PIN.</div>
                )}
              </div>
            ) : (
              <>
                <div className="banner">✓ Card writing unlocked</div>
                <label>Scan or type the card ID</label>
                <div className="row gap">
                  <input value={manualUid} onChange={(e) => setManualUid(e.target.value)} placeholder="Scan card / type ID" style={{ flex: 1 }} />
                  <button className="btn primary" onClick={assignManual} disabled={nfcBusy || !manualUid.trim()}>Assign</button>
                </div>
                <div className="muted small" style={{ margin: '12px 0 4px' }}>— or, with the USB bridge running —</div>
                <button className="btn block" onClick={assignViaReader} disabled={nfcBusy}>
                  💳 {nfcBusy ? 'Tap the card now…' : 'Assign by tapping (USB reader)'}
                </button>
                {nfcSupported() && (
                  <button className="btn block" onClick={issueCard} disabled={nfcBusy}>📶 Write to card (phone NFC)</button>
                )}
              </>
            )}
            {nfcMsg && <div className="banner">{nfcMsg}</div>}
          </div>
        </>
      )}
    </div>
  )
}
