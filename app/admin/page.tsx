'use client'
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import PhotoLoader from '@/app/components/PhotoLoader'
import { authHeaders } from '@/app/utils/session'
import { useLogo } from '@/app/context/LogoContext'

interface Customer {
  id: number
  name: string
  email: string
  phone: string
  eventName: string
  eventDate: string
  photoCount: number
  selectedCount: number
  maxSelectCount: number
  selectionLocked: boolean
  createdAt: string
  accessCode: string
  isDelivered: boolean
}

export default function AdminDashboard() {
  const logoUrl = useLogo()
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)
  const fetchedRef = useRef(false)

  useEffect(() => {
    if (fetchedRef.current) return
    fetchedRef.current = true
    fetch('/api/admin/customers', { headers: authHeaders() })
      .then(res => res.json())
      .then(data => { setCustomers(Array.isArray(data) ? data : []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  const totalPhotos     = customers.reduce((acc, customer) => acc + customer.photoCount, 0)
  const deliveredCount  = customers.filter(customer => customer.isDelivered).length
  const submittedCount  = customers.filter(customer => customer.selectionLocked && !customer.isDelivered).length
  const inProgressCount = customers.filter(customer => !customer.selectionLocked && customer.selectedCount > 0).length
  const pendingCount    = customers.filter(customer => customer.selectedCount === 0).length

  function getStatus(customer: Customer) {
    if (customer.isDelivered)       return 'delivered'
    if (customer.selectionLocked)   return 'locked'
    if (customer.selectedCount > 0) return 'inprogress'
    if (customer.photoCount > 0)    return 'pending'
    return 'new'
  }

  const statusConfig: Record<string, { label: string; bg: string; color: string; border: string; dot: string }> = {
    delivered:  { label: 'Completed',   bg: 'rgba(74,222,128,0.12)',  color: '#4ade80', border: 'rgba(74,222,128,0.25)',  dot: '#4ade80' },
    locked:     { label: 'Submitted',   bg: 'rgba(96,165,250,0.12)',  color: '#60a5fa', border: 'rgba(96,165,250,0.25)',  dot: '#60a5fa' },
    inprogress: { label: 'In Progress', bg: 'rgba(212,160,23,0.12)',  color: '#f0d78c', border: 'rgba(212,160,23,0.25)',  dot: '#d4a017' },
    pending:    { label: 'Pending',     bg: 'rgba(251,191,36,0.12)',  color: '#fbbf24', border: 'rgba(251,191,36,0.25)',  dot: '#fbbf24' },
    new:        { label: 'New',         bg: 'rgba(148,163,184,0.10)', color: '#94a3b8', border: 'rgba(148,163,184,0.2)', dot: '#94a3b8' },
  }

  return (
    <div style={{ padding: '40px 48px', maxWidth: 1300 }}>
      {/* Header */}
      <div style={{ marginBottom: 36 }}>
        <h1 style={{ fontFamily: "'Playfair Display', serif", fontSize: 32, color: '#f5f0e8', marginBottom: 6 }}>Dashboard</h1>
        <p style={{ color: '#8a8070', fontSize: 14 }}>Welcome back — manage your clients and photo deliveries</p>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 18, marginBottom: 44 }}>
        {[
           { label: 'Total Clients',  value: customers.length, icon: '👥', color: '#60a5fa', sub: `${submittedCount} submitted · ${pendingCount} pending` },
          { label: 'Total Photos',  value: totalPhotos,       icon: '📸', color: '#d4a017', sub: 'Across all client folders' },
          { label: 'Completed',      value: deliveredCount,   icon: '✅',  color: '#4ade80', sub: `${submittedCount} submitted · ${inProgressCount} in progress` },
        ].map(stat => (
          <div key={stat.label} className="stat-card" style={{ padding: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
              <p style={{ fontSize: 11, color: '#8a8070', letterSpacing: '0.1em', textTransform: 'uppercase' }}>{stat.label}</p>
              <span style={{ fontSize: 24 }}>{stat.icon}</span>
            </div>
            <p style={{ fontSize: 40, fontWeight: 700, color: stat.color, fontFamily: "'Playfair Display', serif", lineHeight: 1 }}>{stat.value}</p>
            <p style={{ fontSize: 11, color: '#555', marginTop: 8 }}>{stat.sub}</p>
          </div>
        ))}
      </div>

      {/* Client cards section */}
      <div style={{ marginBottom: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, color: '#f5f0e8' }}>All Clients</h2>
        {/* <Link href="/admin/customers">
          <button className="btn-outline" style={{ padding: '8px 18px', borderRadius: 9, fontSize: 13 }}>+ Add Client</button>
        </Link> */}
      </div>

      {loading ? (
        <PhotoLoader message="Loading clients…" />
      ) : customers.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '80px 20px' }}>
          <div style={{ width: 72, height: 72, borderRadius: '50%', background: 'linear-gradient(135deg, #d4a017, #b8860b)', overflow: 'hidden', margin: '0 auto 16px' }}><img src={logoUrl} alt="Praveen Photography" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /></div>
          <p style={{ color: '#555', fontSize: 16, marginBottom: 20 }}>No clients yet</p>
          <Link href="/admin/customers">
            <button className="btn-gold" style={{ padding: '12px 28px', borderRadius: 10, fontSize: 14 }}>Add First Client</button>
          </Link>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 18 }}>
          {customers.map(customer => {
            const status      = getStatus(customer)
            const statusStyle = statusConfig[status]
            const progressPct = customer.maxSelectCount > 0
              ? Math.min(100, Math.round((customer.selectedCount / customer.maxSelectCount) * 100))
              : null

            return (
              <div key={customer.id} style={{
                background: '#0f0f0f', border: '1px solid #1e1e1e', borderRadius: 14,
                padding: 22, transition: 'all 0.25s ease', cursor: 'default',
                position: 'relative', overflow: 'hidden',
              }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLDivElement).style.borderColor = 'rgba(212,160,23,0.3)'
                  ;(e.currentTarget as HTMLDivElement).style.transform   = 'translateY(-2px)'
                  ;(e.currentTarget as HTMLDivElement).style.boxShadow   = '0 8px 32px rgba(0,0,0,0.4)'
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLDivElement).style.borderColor = '#1e1e1e'
                  ;(e.currentTarget as HTMLDivElement).style.transform   = 'translateY(0)'
                  ;(e.currentTarget as HTMLDivElement).style.boxShadow   = 'none'
                }}
              >
                {/* Top row: name + status */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
                  <div style={{ flex: 1, minWidth: 0, paddingRight: 10 }}>
                    <h3 style={{ fontSize: 16, fontWeight: 700, color: '#f5f0e8', marginBottom: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {customer.name}
                    </h3>
                    <p style={{ fontSize: 12, color: '#8a8070', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{customer.eventName}</p>
                  </div>
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 5,
                    background: statusStyle.bg, border: `1px solid ${statusStyle.border}`,
                    borderRadius: 20, padding: '4px 10px', flexShrink: 0,
                  }}>
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: statusStyle.dot, boxShadow: `0 0 6px ${statusStyle.dot}` }} />
                    <span style={{ fontSize: 11, fontWeight: 700, color: statusStyle.color, letterSpacing: '0.05em' }}>{statusStyle.label}</span>
                  </div>
                </div>

                <div style={{ height: 1, background: '#1a1a1a', marginBottom: 14 }} />

                {/* Info grid */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 14px', marginBottom: 16 }}>
                  <div>
                    <p style={{ fontSize: 10, color: '#555', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 3 }}>Photos</p>
                    <p style={{ fontSize: 20, fontWeight: 700, color: '#d4a017', fontFamily: "'Playfair Display', serif" }}>{customer.photoCount}</p>
                  </div>
                  <div>
                    <p style={{ fontSize: 10, color: '#555', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 3 }}>Selected</p>
                    <p style={{ fontSize: 20, fontWeight: 700, color: '#4ade80', fontFamily: "'Playfair Display', serif" }}>
                      {customer.selectedCount}
                      {customer.maxSelectCount > 0 && <span style={{ fontSize: 12, color: '#555', fontFamily: "'DM Sans', sans-serif", fontWeight: 400 }}>/{customer.maxSelectCount}</span>}
                    </p>
                  </div>
                  <div>
                    <p style={{ fontSize: 10, color: '#555', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 3 }}>Event Date</p>
                    <p style={{ fontSize: 13, color: '#8a8070' }}>{customer.eventDate || '—'}</p>
                  </div>
                  <div>
                    <p style={{ fontSize: 10, color: '#555', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 3 }}>Added</p>
                    <p style={{ fontSize: 13, color: '#8a8070' }}>
                      {new Date(customer.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                    </p>
                  </div>
                </div>

                {progressPct !== null && (
                  <div style={{ marginBottom: 14 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                      <span style={{ fontSize: 10, color: '#555', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Selection Progress</span>
                      <span style={{ fontSize: 10, color: '#8a8070' }}>{progressPct}%</span>
                    </div>
                    <div className="progress-bar">
                      <div className="progress-fill" style={{ width: `${progressPct}%` }} />
                    </div>
                  </div>
                )}

                <div style={{ background: 'rgba(212,160,23,0.06)', borderRadius: 8, padding: '8px 12px', marginBottom: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 10, color: '#555', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Access Code</span>
                  <span style={{ fontFamily: 'monospace', fontSize: 13, color: '#f0d78c', fontWeight: 700 }}>{customer.accessCode}</span>
                </div>

                <Link href={`/admin/customers/${customer.id}`} style={{ display: 'block' }}>
                  <button className="btn-gold" style={{ width: '100%', padding: '10px 0', borderRadius: 9, fontSize: 13 }}>
                    Manage Client →
                  </button>
                </Link>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
