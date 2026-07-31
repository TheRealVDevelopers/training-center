import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'

// Owner-only guard for the report pages. Anything showing one member's history
// or the club's money lives behind this — staff pages may LINK here, but the
// owner's email login is what opens it.
export default function OwnerOnly({ children }) {
  const { user, loading, isSuper, logout } = useAuth()
  if (loading) return <div className="center muted">Loading…</div>
  if (!user || user.isAnonymous || !isSuper) {
    return (
      <div className="center">
        <div className="card narrow center-text">
          <div className="brand"><span className="leaf">🌿</span> Owner only</div>
          <p className="muted">This page shows member history and money. Log in with the owner account.</p>
          <Link className="btn primary block" to="/owner">Go to Owner login</Link>
          {user && !user.isAnonymous && <button className="btn block" onClick={logout}>Log out</button>}
        </div>
      </div>
    )
  }
  return children
}

// Shared helper: a WhatsApp deep link for an Indian mobile number.
export function waLink(mobile, text) {
  const digits = String(mobile || '').replace(/\D/g, '')
  if (digits.length < 10) return null
  const withCode = digits.length === 10 ? `91${digits}` : digits.replace(/^0+/, '')
  return `https://wa.me/${withCode}?text=${encodeURIComponent(text)}`
}
