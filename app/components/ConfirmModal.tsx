'use client'

interface ConfirmModalProps {
  icon?: string
  title: string
  message: React.ReactNode
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export default function ConfirmModal({
  icon = '❓',
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div
        className="glass-card"
        onClick={e => e.stopPropagation()}
        style={{ padding: 36, width: '100%', maxWidth: 420, textAlign: 'center' }}
      >
        <div style={{ fontSize: 40, marginBottom: 16 }}>{icon}</div>
        <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: 20, color: '#f5f0e8', marginBottom: 12 }}>
          {title}
        </h2>
        <p style={{ color: '#8a8070', fontSize: 14, marginBottom: 28 }}>{message}</p>
        <div style={{ display: 'flex', gap: 12 }}>
          <button
            onClick={onCancel}
            className="btn-outline"
            style={{ flex: 1, padding: '12px 0', borderRadius: 10, fontSize: 14 }}
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className="btn-outline"
            style={{
              flex: 1,
              padding: '12px 0',
              borderRadius: 10,
              fontSize: 14,
              ...(danger
                ? { color: '#f87171', borderColor: 'rgba(248,113,113,0.4)', background: 'rgba(248,113,113,0.08)' }
                : { color: '#fbbf24', borderColor: 'rgba(251,191,36,0.4)', background: 'rgba(251,191,36,0.08)' }),
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
