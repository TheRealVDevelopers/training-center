import { createContext, useContext, useEffect, useState } from 'react'
import { onAuthStateChanged, signOut } from 'firebase/auth'
import { doc, onSnapshot } from 'firebase/firestore'
import { auth, db } from '../firebase'
import { SUPER_ADMIN_EMAILS } from '../config'

const AuthCtx = createContext(null)

export function useAuth() {
  return useContext(AuthCtx)
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null) // firebase auth user
  const [member, setMember] = useState(null) // members/{uid} profile (live)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    return onAuthStateChanged(auth, (u) => {
      setUser(u)
      setLoading(false)
    })
  }, [])

  // Live subscription to the member profile so balance updates in real time.
  useEffect(() => {
    if (!user) {
      setMember(null)
      return
    }
    return onSnapshot(doc(db, 'members', user.uid), (snap) => {
      setMember(snap.exists() ? { id: snap.id, ...snap.data() } : null)
    })
  }, [user])

  const logout = () => signOut(auth)
  const isSuper = !!user && SUPER_ADMIN_EMAILS.includes(user.email)

  return (
    <AuthCtx.Provider value={{ user, member, loading, logout, isSuper }}>
      {children}
    </AuthCtx.Provider>
  )
}
