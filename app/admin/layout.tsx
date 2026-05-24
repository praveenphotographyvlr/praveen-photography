'use client'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import { useEffect, useState, useRef } from 'react'
import ConfirmModal from '@/app/components/ConfirmModal'
import { authHeaders, clearSession } from '@/app/utils/session'
import { useSessionGuard } from '@/app/hooks/useSessionGuard'
import { useLogo } from '@/app/context/LogoContext'
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const logoUrl = useLogo()
  useSessionGuard()
  const pathname = usePathname()
  const [expiring, setExpiring] = useState<ExpiringClient[]>([])
  const [bellOpen, setBellOpen] = useState(false)
  const [confirmSignOut, setConfirmSignOut] = useState(false)
  const bellRef = useRef<HTMLDivElement>(null)
  const expiringFetchedRef = useRef(false)
  interface ExpiringClient {
  id: number
  name: string
  daysLeft: number
}

  useEffect(() => {
    if (expiringFetchedRef.current) return
    expiringFetchedRef.current = true
    fetch('/api/admin/expiring', { headers: authHeaders() })
      .then(r => r.ok ? r.json() : [])
      .then(d => Array.isArray(d) ? setExpiring(d) : null)
      .catch(() => {})
  }, [])

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) {
        setBellOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  function logout() {
    clearSession()
    router.replace('/')
  }

  const navItems = [
    { href: '/admin', label: 'Dashboard', icon: '◈' },
    { href: '/admin/customers', label: 'Customers', icon: '👥' },
  ]

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#0a0a0a' }}>
      {/* Sidebar */}
      <aside style={{
        width: 240, background: '#0d0d0d', borderRight: '1px solid #1a1a1a',
        display: 'flex', flexDirection: 'column', padding: '24px 16px', flexShrink: 0,
      }}>
        <div style={{ marginBottom: 40 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, paddingLeft: 8 }}>
            <div style={{
              width: 36, height: 36, borderRadius: '50%',
              background: 'linear-gradient(135deg, #d4a017, #b8860b)',
              overflow: 'hidden', flexShrink: 0,
            }}><img src={logoUrl} alt="Praveen Photography" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /></div>
            <div>
              <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 14, color: '#f0d78c', fontWeight: 600 }}>Praveen</div>
              <div style={{ fontSize: 10, color: '#555', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Photography</div>
            </div>
          </div>
        </div>

        <nav style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ fontSize: 10, color: '#444', letterSpacing: '0.12em', textTransform: 'uppercase', paddingLeft: 8, marginBottom: 8 }}>Navigation</div>
          {navItems.map(item => (
            <Link key={item.href} href={item.href}
              className={`nav-item ${pathname === item.href ? 'active' : ''}`}>
              <span style={{ fontSize: 16 }}>{item.icon}</span>
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>

      {/* Main area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Top header */}
        <header style={{
          height: 60, background: '#0d0d0d', borderBottom: '1px solid #1a1a1a',
          display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
          padding: '0 32px', gap: 16, flexShrink: 0,
        }}>
          {/* Notification Bell */}
          <div ref={bellRef} style={{ position: 'relative' }}>
            <button
              onClick={() => setBellOpen(v => !v)}
              title={expiring.length ? `${expiring.length} client(s) expiring soon` : 'No notifications'}
              style={{
                background: expiring.length ? 'rgba(245,158,11,0.08)' : 'transparent',
                border: `1px solid ${expiring.length ? 'rgba(245,158,11,0.2)' : '#222'}`,
                cursor: 'pointer', position: 'relative',
                width: 36, height: 36, borderRadius: 10,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 16, color: expiring.length ? '#f59e0b' : '#444',
                transition: 'all 0.2s',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = expiring.length ? 'rgba(245,158,11,0.4)' : '#333'; (e.currentTarget as HTMLButtonElement).style.color = expiring.length ? '#fbbf24' : '#777' }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = expiring.length ? 'rgba(245,158,11,0.2)' : '#222'; (e.currentTarget as HTMLButtonElement).style.color = expiring.length ? '#f59e0b' : '#444' }}
            >
              🔔
              {expiring.length > 0 && (
                <span style={{
                  position: 'absolute', top: -4, right: -4,
                  background: '#ef4444', color: '#fff', borderRadius: '50%',
                  width: 16, height: 16, fontSize: 9, fontWeight: 700,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  boxShadow: '0 0 0 2px #0d0d0d',
                }}>
                  {expiring.length}
                </span>
              )}
            </button>

            {bellOpen && (
              <div style={{
                position: 'absolute', top: 'calc(100% + 10px)', right: 0,
                background: '#141414', border: '1px solid #242424',
                borderRadius: 14, minWidth: 280, zIndex: 300,
                boxShadow: '0 12px 40px rgba(0,0,0,0.8)',
                overflow: 'hidden',
              }}>
                <div style={{ padding: '12px 16px 10px', borderBottom: '1px solid #1e1e1e', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 14 }}>🔔</span>
                  <div style={{ fontSize: 11, color: '#8a8070', letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 600 }}>
                    Expiring Soon
                  </div>
                </div>
                {expiring.length === 0 ? (
                  <div style={{ padding: '16px', fontSize: 12, color: '#555', textAlign: 'center' }}>No clients expiring soon</div>
                ) : (
                  expiring.map(c => (
                    <Link key={c.id} href={`/admin/customers/${c.id}`} onClick={() => setBellOpen(false)}>
                      <div
                        style={{
                          padding: '10px 16px',
                          borderLeft: `3px solid ${c.daysLeft <= 2 ? '#ef4444' : '#f59e0b'}`,
                          cursor: 'pointer', transition: 'background 0.15s',
                        }}
                        onMouseEnter={e => (e.currentTarget.style.background = '#1c1c1c')}
                        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                      >
                        <div style={{ fontSize: 13, color: '#f5f0e8', fontWeight: 600 }}>{c.name}</div>
                        <div style={{ fontSize: 11, color: c.daysLeft <= 2 ? '#ef4444' : '#f59e0b', marginTop: 2 }}>
                          Auto-deletes in {c.daysLeft} day{c.daysLeft !== 1 ? 's' : ''}
                        </div>
                      </div>
                    </Link>
                  ))
                )}
              </div>
            )}
          </div>

          {/* Vertical divider */}
          <div style={{ width: 1, height: 24, background: '#1e1e1e', flexShrink: 0 }} />

          {/* User identity + Sign Out */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {/* Avatar chip */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
              <div style={{
                width: 32, height: 32, borderRadius: '50%',
                background: 'linear-gradient(135deg, #d4a017, #b8860b)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 13, fontWeight: 700, color: '#0a0a0a', flexShrink: 0,
              }}>A</div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#f0d78c', lineHeight: 1.2 }}>Admin</div>
                <div style={{ fontSize: 10, color: '#555', lineHeight: 1.2 }}>Studio Manager</div>
              </div>
            </div>

            {/* Sign Out button */}
            <button
              onClick={() => setConfirmSignOut(true)}
              title="Sign Out"
              style={{
                background: 'rgba(248,113,113,0.06)',
                border: '1px solid rgba(248,113,113,0.18)',
                cursor: 'pointer', color: '#f87171',
                borderRadius: 9, padding: '7px 14px',
                fontSize: 12, fontWeight: 600,
                display: 'flex', alignItems: 'center', gap: 6,
                transition: 'all 0.2s', letterSpacing: '0.01em',
              }}
              onMouseEnter={e => { const b = e.currentTarget as HTMLButtonElement; b.style.background = 'rgba(248,113,113,0.14)'; b.style.borderColor = 'rgba(248,113,113,0.35)' }}
              onMouseLeave={e => { const b = e.currentTarget as HTMLButtonElement; b.style.background = 'rgba(248,113,113,0.06)'; b.style.borderColor = 'rgba(248,113,113,0.18)' }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
              </svg>
              Sign Out
            </button>
          </div>
        </header>

        {confirmSignOut && (
          <ConfirmModal
            icon="🚪"
            title="Sign Out"
            message="Are you sure you want to sign out?"
            confirmLabel="Sign Out"
            cancelLabel="Stay"
            danger
            onConfirm={logout}
            onCancel={() => setConfirmSignOut(false)}
          />
        )}

        {/* Page content */}
        <main style={{ flex: 1, overflow: 'auto' }}>
          {children}
        </main>
      </div>
    </div>
  )
}
