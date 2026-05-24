'use client'
import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { saveAdminSession, saveCustomerSession, getSessionRole } from '@/app/utils/session'

function LoginContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const defaultRole = searchParams.get('role') === 'admin' ? 'admin' : 'customer'

  const [role, setRole] = useState<'admin' | 'customer'>(defaultRole)

  useEffect(() => {
    const role = getSessionRole()
    if (role === 'admin') router.replace('/admin')
    else if (role === 'customer') router.replace('/customer')
  }, [router])
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [accessCode, setAccessCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async () => {
    setError('')
    setLoading(true)
    try {
      if (role === 'admin') {
        const res = await fetch('/api/auth/admin', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password }),
        })
        const data = await res.json()
        if (!res.ok) { setError(data.error || 'Login failed'); return }
        saveAdminSession(data.token)
        router.push('/admin')
      } else {
        const res = await fetch('/api/auth/customer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accessCode }),
        })
        const data = await res.json()
        if (!res.ok) { setError(data.error || 'Invalid access code'); return }
        saveCustomerSession(data.token, data.customerId)
        router.push('/customer')
      }
    } catch {
      setError('Network error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0a', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px', position: 'relative' }}>
      <div style={{ position: 'absolute', top: '30%', left: '50%', transform: 'translate(-50%,-50%)', width: '600px', height: '600px', borderRadius: '50%', background: 'radial-gradient(circle, rgba(212,160,23,0.05) 0%, transparent 70%)', pointerEvents: 'none' }} />

      <div style={{ width: '100%', maxWidth: '420px' }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '40px' }}>
          <button onClick={() => router.push('/')} style={{ background: 'none', border: 'none', color: '#8a8070', fontSize: '13px', cursor: 'pointer', marginBottom: '24px', fontFamily: "'DM Sans', sans-serif" }}>← Back</button>
          <h1 style={{ fontFamily: "'Playfair Display', serif", fontSize: '32px', color: '#f5f0e8', marginBottom: '6px' }}>
            {role === 'admin' ? 'Admin Portal' : 'View My Photos'}
          </h1>
          <p style={{ color: '#8a8070', fontSize: '14px', fontFamily: "'DM Sans', sans-serif" }}>
            {role === 'admin' ? 'Sign in to manage your studio' : 'Enter your access code to view your gallery'}
          </p>
        </div>

        {/* Role toggle */}
        <div style={{ display: 'flex', background: 'rgba(255,255,255,0.04)', borderRadius: '10px', padding: '4px', marginBottom: '32px', border: '1px solid rgba(255,255,255,0.06)' }}>
          {(['customer', 'admin'] as const).map(roleOption => (
            <button
              key={roleOption}
              onClick={() => { setRole(roleOption); setError('') }}
              style={{ flex: 1, padding: '10px', borderRadius: '7px', border: 'none', cursor: 'pointer', fontSize: '13px', fontWeight: 500, fontFamily: "'DM Sans', sans-serif", transition: 'all 0.2s ease', background: role === roleOption ? (roleOption === 'admin' ? 'rgba(255,255,255,0.08)' : 'linear-gradient(135deg, #d4a017, #b8860b)') : 'transparent', color: role === roleOption ? (roleOption === 'admin' ? '#f5f0e8' : '#0a0a0a') : '#8a8070' }}
            >
              {roleOption === 'customer' ? '📸 Customer' : '🔐 Admin'}
            </button>
          ))}
        </div>

        {/* Form */}
        <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(212,160,23,0.12)', borderRadius: '16px', padding: '32px' }}>
          {role === 'admin' ? (
            <>
              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontSize: '12px', color: '#8a8070', letterSpacing: '0.08em', marginBottom: '8px', fontFamily: "'DM Sans', sans-serif" }}>USERNAME</label>
                <input
                  className="input-dark"
                  style={{ padding: '12px 16px', fontSize: '14px' }}
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  placeholder="admin"
                  onKeyDown={e => e.key === 'Enter' && handleSubmit()}
                />
              </div>
              <div style={{ marginBottom: '24px' }}>
                <label style={{ display: 'block', fontSize: '12px', color: '#8a8070', letterSpacing: '0.08em', marginBottom: '8px', fontFamily: "'DM Sans', sans-serif" }}>PASSWORD</label>
                <input
                  className="input-dark"
                  style={{ padding: '12px 16px', fontSize: '14px' }}
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  onKeyDown={e => e.key === 'Enter' && handleSubmit()}
                />
              </div>
            </>
          ) : (
            <div style={{ marginBottom: '24px' }}>
              <label style={{ display: 'block', fontSize: '12px', color: '#8a8070', letterSpacing: '0.08em', marginBottom: '8px', fontFamily: "'DM Sans', sans-serif" }}>ACCESS CODE</label>
              <input
                className="input-dark"
                style={{ padding: '14px 16px', fontSize: '16px', letterSpacing: '0.2em', textAlign: 'center', textTransform: 'uppercase' }}
                value={accessCode}
                onChange={e => setAccessCode(e.target.value.toUpperCase())}
                placeholder="PP•••••••••"
                onKeyDown={e => e.key === 'Enter' && handleSubmit()}
                maxLength={11}
              />
              <p style={{ fontSize: '12px', color: '#555', marginTop: '8px', fontFamily: "'DM Sans', sans-serif" }}>
                Your access code was sent to you by Praveen Photography
              </p>
            </div>
          )}

          {error && (
            <div style={{ background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.2)', borderRadius: '8px', padding: '10px 14px', marginBottom: '16px', fontSize: '13px', color: '#f87171', fontFamily: "'DM Sans', sans-serif" }}>
              {error}
            </div>
          )}

          <button
            onClick={handleSubmit}
            disabled={loading}
            className="btn-gold"
            style={{ width: '100%', padding: '14px', borderRadius: '10px', fontSize: '15px', fontFamily: "'DM Sans', sans-serif" }}
          >
            {loading ? (
              <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' }}>
                <span className="spinner" style={{ width: '16px', height: '16px', borderWidth: '2px' }} />
                Signing in...
              </span>
            ) : (
              role === 'admin' ? 'Sign In to Admin Portal' : 'Access My Gallery'
            )}
          </button>

          {role === 'admin' && (
            <p style={{ textAlign: 'center', fontSize: '11px', color: '#444', marginTop: '16px', fontFamily: "'DM Sans', sans-serif" }}>
              First time? Use username: <strong style={{ color: '#666' }}>admin</strong> with any password to auto-create account
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div style={{ minHeight: '100vh', background: '#0a0a0a' }} />}>
      <LoginContent />
    </Suspense>
  )
}
