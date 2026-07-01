import { Navigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'

// Gate for member routes — just requires a logged-in account.
// (Admin & scanner use code-gating via CodeGate; /super uses the super-admin
// email check inside the SuperAdmin page.)
export default function ProtectedRoute({ children }) {
  const { user, loading } = useAuth()
  if (loading) return null
  if (!user) return <Navigate to="/login" replace />
  return children
}
