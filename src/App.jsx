import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './auth/AuthContext'
import ProtectedRoute from './components/ProtectedRoute'
import CodeGate from './components/CodeGate'
import Login from './pages/Login'
import Signup from './pages/Signup'
import Dashboard from './pages/Dashboard'
import BookingView from './pages/BookingView'
import Scan from './pages/Scan'
import AdminDashboard from './pages/AdminDashboard'
import AdminCredits from './pages/AdminCredits'
import SuperAdmin from './pages/SuperAdmin'

export default function App() {
  const { loading } = useAuth()
  if (loading) return <div className="center muted">Loading…</div>

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />

      {/* Owner-only control hub (email login) */}
      <Route path="/super" element={<SuperAdmin />} />

      {/* Code-gated: volunteers/staff type a 6-digit code (owner bypasses) */}
      <Route path="/scan" element={<CodeGate kind="scanner" label="Scanner"><Scan /></CodeGate>} />
      <Route path="/admin" element={<CodeGate kind="admin" label="Admin"><AdminDashboard /></CodeGate>} />
      <Route path="/admin/credits" element={<CodeGate kind="admin" label="Admin"><AdminCredits /></CodeGate>} />

      {/* Member routes (account login) */}
      <Route path="/" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
      <Route path="/booking/:id" element={<ProtectedRoute><BookingView /></ProtectedRoute>} />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
