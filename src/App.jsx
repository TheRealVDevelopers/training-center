import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './auth/AuthContext'
import ProtectedRoute from './components/ProtectedRoute'
import CodeGate from './components/CodeGate'
import Login from './pages/Login'
import Signup from './pages/Signup'
import Dashboard from './pages/Dashboard'
import BookingView from './pages/BookingView'
import AdminCredits from './pages/AdminCredits'
import AdminAnalytics from './pages/AdminAnalytics'
import AdminReport from './pages/AdminReport'
import SuperAdmin from './pages/SuperAdmin'
import Profile from './pages/Profile'
import Door from './pages/Door'
import GateFeed from './pages/GateFeed'
import CardPrint from './pages/CardPrint'
import CardStudio from './pages/CardStudio'
import TestCard from './pages/TestCard'

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
      <Route path="/door" element={<CodeGate kind="scanner" label="Door"><Door /></CodeGate>} />
      <Route path="/feed" element={<CodeGate kind="scanner" label="Live Board"><GateFeed /></CodeGate>} />
      <Route path="/admin/card/:id" element={<CodeGate kind="admin" label="Print Card"><CardPrint /></CodeGate>} />
      <Route path="/admin/print" element={<CodeGate kind="admin" label="Card Studio"><CardStudio /></CodeGate>} />
      <Route path="/admin/testcard" element={<CodeGate kind="admin" label="Printer Test"><TestCard /></CodeGate>} />
      {/* /admin = the live reception board; /admin/command = analytics dashboard */}
      <Route path="/admin" element={<CodeGate kind="admin" label="Reception"><GateFeed control /></CodeGate>} />
      <Route path="/admin/command" element={<CodeGate kind="admin" label="Analytics"><AdminAnalytics /></CodeGate>} />
      <Route path="/admin/credits" element={<CodeGate kind="admin" label="Admin"><AdminCredits /></CodeGate>} />
      <Route path="/admin/report" element={<CodeGate kind="admin" label="Admin"><AdminReport /></CodeGate>} />

      {/* Member routes (account login) */}
      <Route path="/" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
      <Route path="/booking/:id" element={<ProtectedRoute><BookingView /></ProtectedRoute>} />
      <Route path="/profile" element={<ProtectedRoute><Profile /></ProtectedRoute>} />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
