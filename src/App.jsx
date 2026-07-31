import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './auth/AuthContext'
import ProtectedRoute from './components/ProtectedRoute'
import PinGate from './components/PinGate'
import Login from './pages/Login'
import Signup from './pages/Signup'
import Dashboard from './pages/Dashboard'
import Profile from './pages/Profile'
import Reception from './pages/Reception'
import Owner from './pages/Owner'
import Door from './pages/Door'
import CardStudio from './pages/CardStudio'
import TestCard from './pages/TestCard'
import Poster from './pages/Poster'
import CardTrack from './pages/CardTrack'
import OwnerOnly from './components/OwnerOnly'
import MemberProfile from './pages/MemberProfile'
import SessionReport from './pages/SessionReport'
import FollowUp from './pages/FollowUp'
import MonthReport from './pages/MonthReport'
import Matrix from './pages/Matrix'
import ActivityLog from './pages/ActivityLog'

export default function App() {
  const { loading } = useAuth()
  if (loading) return <div className="center muted">Loading…</div>

  return (
    <Routes>
      {/* Members */}
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />
      <Route path="/" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
      <Route path="/profile" element={<ProtectedRoute><Profile /></ProtectedRoute>} />

      {/* Staff — one screen, one PIN (typed once per device) */}
      <Route path="/admin" element={<PinGate label="Reception"><Reception /></PinGate>} />
      <Route path="/admin/print" element={<PinGate label="Card Studio"><CardStudio /></PinGate>} />
      <Route path="/admin/testcard" element={<PinGate label="Printer test"><TestCard /></PinGate>} />
      <Route path="/admin/cards" element={<PinGate label="Card Tracking"><CardTrack /></PinGate>} />

      {/* Owner — email login */}
      <Route path="/owner" element={<Owner />} />
      <Route path="/owner/member/:id" element={<OwnerOnly><MemberProfile /></OwnerOnly>} />
      <Route path="/owner/session/:date" element={<OwnerOnly><SessionReport /></OwnerOnly>} />
      <Route path="/owner/month/:month" element={<OwnerOnly><MonthReport /></OwnerOnly>} />
      <Route path="/owner/month" element={<OwnerOnly><MonthReport /></OwnerOnly>} />
      <Route path="/owner/matrix" element={<OwnerOnly><Matrix /></OwnerOnly>} />
      <Route path="/owner/activity" element={<OwnerOnly><ActivityLog /></OwnerOnly>} />
      <Route path="/owner/followup" element={<OwnerOnly><FollowUp /></OwnerOnly>} />

      {/* Public: the door QR screen and the watch-only live board it opens */}
      <Route path="/door" element={<Door />} />
      <Route path="/feed" element={<Reception viewOnly />} />
      <Route path="/poster" element={<Poster />} />

      {/* Old links keep working */}
      <Route path="/super" element={<Navigate to="/owner" replace />} />
      <Route path="/admin/command" element={<Navigate to="/owner" replace />} />
      <Route path="/admin/credits" element={<Navigate to="/owner" replace />} />
      <Route path="/admin/cards" element={<Navigate to="/owner" replace />} />
      <Route path="/admin/report" element={<Navigate to="/owner" replace />} />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
