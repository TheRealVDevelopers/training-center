import { Navigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'

// Gate for member routes — just requires a logged-in account.
// (Staff pages use PinGate; /owner checks the owner email inside Owner.)
export default function ProtectedRoute({ children }) {
  const { user, loading } = useAuth()
  if (loading) return null
  if (!user) return <Navigate to="/login" replace />
  if (user.isAnonymous) return <Navigate to="/admin" replace /> // staff device
  return children
}
