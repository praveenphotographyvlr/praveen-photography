'use client'

interface AlertModalProps {
  type: 'success' | 'error' | 'warning'
  message: string
  onClose: () => void
}

const CONFIG = {
  success: { color: '#4ade80', bg: 'rgba(74,222,128,0.08)',  border: 'rgba(74,222,128,0.2)',  ring: 'rgba(74,222,128,0.15)',  title: 'Success' },
  error:   { color: '#f87171', bg: 'rgba(248,113,113,0.08)', border: 'rgba(248,113,113,0.2)', ring: 'rgba(248,113,113,0.15)', title: 'Error'   },
  warning: { color: '#fbbf24', bg: 'rgba(251,191,36,0.08)',  border: 'rgba(251,191,36,0.2)',  ring: 'rgba(251,191,36,0.15)',  title: 'Warning' },
}

function Icon({ type, color }: { type: AlertModalProps['type']; color: string }) {
  if (type === 'success') return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
  if (type === 'error') return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  )
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
      <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
    </svg>
  )
}

export default function AlertModal({ type, message, onClose }: AlertModalProps) {
  const c = CONFIG[type]
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="glass-card"
        onClick={e => e.stopPropagation()}
        style={{ padding: '36px 32px', width: '100%', maxWidth: 380, textAlign: 'center' }}
      >
        {/* Icon circle */}
        <div style={{
          width: 64, height: 64, borderRadius: '50%',
          background: c.ring,
          border: `2px solid ${c.border}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          margin: '0 auto 20px',
        }}>
          <Icon type={type} color={c.color} />
        </div>

        <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: 20, color: '#f5f0e8', marginBottom: 10 }}>
          {c.title}
        </h2>
        <p style={{ color: '#8a8070', fontSize: 14, lineHeight: 1.65, marginBottom: 28 }}>{message}</p>

        <button
          onClick={onClose}
          style={{
            width: '100%', padding: '12px 0', borderRadius: 10, fontSize: 14, fontWeight: 600,
            cursor: 'pointer', border: `1px solid ${c.border}`,
            background: c.bg, color: c.color,
            fontFamily: "'DM Sans', sans-serif", transition: 'opacity 0.2s',
          }}
          onMouseEnter={e => { e.currentTarget.style.opacity = '0.75' }}
          onMouseLeave={e => { e.currentTarget.style.opacity = '1' }}
        >
          OK
        </button>
      </div>
    </div>
  )
}
