'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { saveAdminSession, saveCustomerSession, getSessionRole } from '@/app/utils/session'
import { useLogo } from '@/app/context/LogoContext'

export default function HomePage() {
  const router = useRouter()
  const logoUrl = useLogo()
  const [showAdminModal, setShowAdminModal] = useState(false)

  useEffect(() => {
    const role = getSessionRole()
    if (role === 'admin') router.replace('/admin')
    else if (role === 'customer') router.replace('/customer')
  }, [router])
  const [adminForm, setAdminForm] = useState({ username: '', password: '' })
  const [showAdminPassword, setShowAdminPassword] = useState(false)
  const [customerCode, setCustomerCode] = useState('')
  const [loadingAdmin, setLoadingAdmin] = useState(false)
  const [loadingCustomer, setLoadingCustomer] = useState(false)
  const [adminError, setAdminError] = useState('')
  const [customerError, setCustomerError] = useState('')

  async function handleAdminLogin(e: React.FormEvent) {
    e.preventDefault()
    setAdminError('')
    setLoadingAdmin(true)
    try {
      const res = await fetch('/api/auth/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...adminForm, username: adminForm.username.trim() }),
      })
      const data = await res.json()
      if (!res.ok) { setAdminError(data.error || 'Invalid credentials'); return }
      saveAdminSession(data.token)
      router.push('/admin')
    } finally {
      setLoadingAdmin(false)
    }
  }

  async function handleCustomerLogin(e: React.FormEvent) {
    e.preventDefault()
    setCustomerError('')
    if (!customerCode.trim()) { setCustomerError('Please enter your access code'); return }
    setLoadingCustomer(true)
    try {
      const res = await fetch('/api/auth/customer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessCode: customerCode.trim() }),
      })
      const data = await res.json()
      if (!res.ok) { setCustomerError(data.error || 'Invalid access code'); return }
      saveCustomerSession(data.token, data.customerId)
      router.push('/customer')
    } finally {
      setLoadingCustomer(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0a', position: 'relative' }}>

      {/* Admin login — top-right corner */}
      <div style={{ position: 'fixed', top: 20, right: 24, zIndex: 1000 }}>
        <button
          onClick={() => { setShowAdminModal(true); setAdminError('') }}
          style={{
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(212,160,23,0.25)',
            color: '#8a8070',
            borderRadius: 10,
            padding: '8px 18px',
            fontSize: 13,
            fontFamily: "'DM Sans', sans-serif",
            fontWeight: 500,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 7,
            transition: 'all 0.25s',
            backdropFilter: 'blur(8px)',
          }}
          onMouseEnter={e => {
            const el = e.currentTarget
            el.style.borderColor = 'rgba(212,160,23,0.5)'
            el.style.color = '#f0d78c'
            el.style.background = 'rgba(212,160,23,0.08)'
          }}
          onMouseLeave={e => {
            const el = e.currentTarget
            el.style.borderColor = 'rgba(212,160,23,0.25)'
            el.style.color = '#8a8070'
            el.style.background = 'rgba(255,255,255,0.05)'
          }}
        >
          <span style={{ fontSize: 14 }}>⚙️</span>
          Admin Login
        </button>
      </div>

      {/* Main centered customer login */}
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'radial-gradient(ellipse at 50% 0%, rgba(212,160,23,0.08) 0%, transparent 65%)',
        padding: '40px 20px',
      }}>
        <div style={{ width: '100%', maxWidth: 420 }}>

          {/* Logo + brand */}
          <div style={{ textAlign: 'center', marginBottom: 44 }}>
            <div style={{
              width: 76, height: 76, borderRadius: '50%',
              background: 'linear-gradient(135deg, #d4a017, #b8860b)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              margin: '0 auto 20px', overflow: 'hidden',
              boxShadow: '0 0 50px rgba(212,160,23,0.25), 0 0 100px rgba(212,160,23,0.1)',
            }}><img src={logoUrl} alt="Praveen Photography" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /></div>
            <h1 className="gold-text" style={{ fontFamily: "'Playfair Display', serif", fontSize: 34, fontWeight: 700, marginBottom: 8 }}>
              Praveen Photography
            </h1>
            <p style={{ color: '#8a8070', fontSize: 12, letterSpacing: '0.18em', textTransform: 'uppercase' }}>
              Capturing Moments · Crafting Memories
            </p>
          </div>

          {/* Customer login card */}
          <div className="glass-card" style={{ padding: 36 }}>
            <div style={{ marginBottom: 24, textAlign: 'center' }}>
              <h2 style={{ color: '#f5f0e8', fontSize: 20, fontWeight: 600, marginBottom: 6, fontFamily: "'Playfair Display', serif" }}>
                View Your Photos
              </h2>
              <p style={{ color: '#555', fontSize: 13 }}>Enter the access code sent to you by your photographer</p>
            </div>

            <form onSubmit={handleCustomerLogin}>
              <div style={{ marginBottom: 20 }}>
                <label style={{ display: 'block', fontSize: 11, color: '#8a8070', marginBottom: 8, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                  Access Code
                </label>
                <input
                  className="input-dark"
                  value={customerCode}
                  onChange={e => { setCustomerCode(e.target.value); setCustomerError('') }}
                  placeholder="e.g. PPXYZ123456"
                  style={{ padding: '13px 16px', fontSize: 15, letterSpacing: '0.06em', textAlign: 'center' }}
                  autoComplete="off"
                  autoCapitalize="characters"
                />
              </div>

              {customerError && (
                <div style={{ background: '#1a0505', border: '1px solid rgba(248,113,113,0.3)', borderRadius: 8, padding: '10px 14px', color: '#f87171', fontSize: 13, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span>⚠️</span> {customerError}
                </div>
              )}

              <button type="submit" className="btn-gold" disabled={loadingCustomer}
                style={{ width: '100%', padding: '14px 0', borderRadius: 10, fontSize: 15, fontWeight: 600 }}>
                {loadingCustomer ? (
                  <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                    <span style={{ width: 16, height: 16, border: '2px solid rgba(0,0,0,0.3)', borderTopColor: '#0a0a0a', borderRadius: '50%', display: 'inline-block', animation: 'spin 0.7s linear infinite' }} />
                    Signing in…
                  </span>
                ) : '🎞 View My Photos'}
              </button>
            </form>
          </div>

          <p style={{ textAlign: 'center', color: '#333', fontSize: 12, marginTop: 28 }}>
            © {new Date().getFullYear()} Praveen Photography · All rights reserved
          </p>
        </div>
      </div>

      {/* Admin login modal */}
      {showAdminModal && (
        <div className="modal-overlay" onClick={() => setShowAdminModal(false)}>
          <div className="glass-card" onClick={e => e.stopPropagation()}
            style={{ padding: 36, width: '100%', maxWidth: 380, position: 'relative' }}>

            {/* Close */}
            <button onClick={() => setShowAdminModal(false)}
              style={{ position: 'absolute', top: 14, right: 16, background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>✕</button>

            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 28, marginBottom: 10 }}>⚙️</div>
              <h2 style={{ color: '#f5f0e8', fontSize: 20, fontWeight: 600, fontFamily: "'Playfair Display', serif", marginBottom: 4 }}>Admin Access</h2>
              <p style={{ color: '#555', fontSize: 13 }}>Sign in to manage clients and photos</p>
            </div>

            <form onSubmit={handleAdminLogin}>
              <div style={{ marginBottom: 14 }}>
                <label style={{ display: 'block', fontSize: 11, color: '#8a8070', marginBottom: 7, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Username</label>
                <input
                  className="input-dark"
                  value={adminForm.username}
                  onChange={e => { setAdminForm(prev => ({ ...prev, username: e.target.value })); setAdminError('') }}
                  onBlur={e => setAdminForm(prev => ({ ...prev, username: e.target.value.trim() }))}
                  placeholder="admin"
                  style={{ padding: '12px 14px', fontSize: 14 }}
                  required
                  autoFocus
                />
              </div>
              <div style={{ marginBottom: 20 }}>
                <label style={{ display: 'block', fontSize: 11, color: '#8a8070', marginBottom: 7, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Password</label>
                <div style={{ position: 'relative' }}>
                  <input
                    className="input-dark"
                    type={showAdminPassword ? 'text' : 'password'}
                    value={adminForm.password}
                    onChange={e => { setAdminForm(prev => ({ ...prev, password: e.target.value })); setAdminError('') }}
                    placeholder="••••••••"
                    style={{ padding: '12px 40px 12px 14px', fontSize: 14 }}
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowAdminPassword(v => !v)}
                    style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#555', padding: 0, display: 'flex', alignItems: 'center' }}
                  >
                    {showAdminPassword ? (
                      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/>
                      </svg>
                    ) : (
                      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
                      </svg>
                    )}
                  </button>
                </div>
              </div>

              {adminError && (
                <div style={{ background: '#1a0505', border: '1px solid rgba(248,113,113,0.3)', borderRadius: 8, padding: '10px 14px', color: '#f87171', fontSize: 13, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span>⚠️</span> {adminError}
                </div>
              )}

              <button type="submit" className="btn-gold" disabled={loadingAdmin}
                style={{ width: '100%', padding: '13px 0', borderRadius: 10, fontSize: 14 }}>
                {loadingAdmin ? (
                  <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                    <span style={{ width: 14, height: 14, border: '2px solid rgba(0,0,0,0.3)', borderTopColor: '#0a0a0a', borderRadius: '50%', display: 'inline-block', animation: 'spin 0.7s linear infinite' }} />
                    Signing in…
                  </span>
                ) : 'Access Admin Panel →'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
