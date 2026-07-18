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

      {/* Door screen stays behind the scanner code (owner bypasses). */}
      <Route path="/door" element={<CodeGate kind="scanner" label="Door"><Door /></CodeGate>} />
      <Route path="/feed" element={<CodeGate kind="scanner" label="Live Board"><GateFeed /></CodeGate>} />
      {/* Admin pages open directly — no code. (Card writing is still protected
          by its own Write PIN inside Credits.) */}
      <Route path="/admin/card/:id" element={<CardPrint />} />
      <Route path="/admin/print" element={<CardStudio />} />
      <Route path="/admin/testcard" element={<TestCard />} />
      {/* /admin = the live reception board; /admin/command = analytics dashboard */}
      <Route path="/admin" element={<GateFeed control />} />
      <Route path="/admin/command" element={<AdminAnalytics />} />
      <Route path="/admin/credits" element={<AdminCredits />} />
      <Route path="/admin/report" element={<AdminReport />} />

      {/* Member routes (account login) */}
      <Route path="/" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
      <Route path="/booking/:id" element={<ProtectedRoute><BookingView /></ProtectedRoute>} />
      <Route path="/profile" element={<ProtectedRoute><Profile /></ProtectedRoute>} />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
