'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import ConfirmModal from '@/app/components/ConfirmModal'
import AlertModal from '@/app/components/AlertModal'
import PhotoLoader from '@/app/components/PhotoLoader'
import { authHeaders } from '@/app/utils/session'

interface Customer {
  id: number; name: string; email: string; phone: string
  eventName: string; eventDate: string; accessCode: string
  photoCount: number; selectedCount: number; maxSelectCount: number
  selectionLocked: boolean; createdAt: string; isDelivered: boolean
}

interface FormErrors {
  name?: string; email?: string; phone?: string
  eventName?: string; eventDate?: string; maxSelectCount?: string
}

export default function CustomersPage() {
  const [customers, setCustomers]     = useState<Customer[]>([])
  const [loading, setLoading]         = useState(true)
  const [showModal, setShowModal]     = useState(false)
  const [form, setForm]               = useState({ name: '', email: '', phone: '', eventName: '', eventDate: '', maxSelectCount: '' })
  const [errors, setErrors]           = useState<FormErrors>({})
  const [touched, setTouched]         = useState<Record<string, boolean>>({})
  const [saving, setSaving]           = useState(false)
  const [alert, setAlert]             = useState<{ msg: string; type: 'success' | 'error' | 'warning' } | null>(null)
  const [search, setSearch]           = useState('')
  const [confirmDelete, setConfirmDelete] = useState<{ id: number; name: string } | null>(null)
  const [editCustomer, setEditCustomer]   = useState<Customer | null>(null)
  const [editForm, setEditForm]           = useState({ name: '', email: '', phone: '', eventName: '', eventDate: '', maxSelectCount: '' })
  const [editSaving, setEditSaving]       = useState(false)
  const [editErrors, setEditErrors]       = useState<FormErrors>({})
  const [editTouched, setEditTouched]     = useState<Record<string, boolean>>({})

  function showToast(msg: string, type: 'success' | 'error' | 'warning' = 'success') {
    setAlert({ msg, type })
  }

  async function loadCustomers() {
    setLoading(true)
    const res  = await fetch('/api/admin/customers', { headers: authHeaders() })
    const data = await res.json()
    setCustomers(Array.isArray(data) ? data : [])
    setLoading(false)
  }

  useEffect(() => {
    loadCustomers()
    fetch('/api/admin/expiring', { headers: authHeaders() })
      .then(res => res.ok ? res.json() : [])
      .then((list: { name: string; daysLeft: number }[]) => {
        if (!list.length) return
        const msg = list.length === 1
          ? `⚠ ${list[0].name} will be auto-deleted in ${list[0].daysLeft} day${list[0].daysLeft !== 1 ? 's' : ''}`
          : `⚠ ${list.length} clients will be auto-deleted within 5 days`
        showToast(msg, 'warning')
      })
      .catch(() => {})
  }, [])

  function validateField(key: string, value: string): string {
    switch (key) {
      case 'name':
        if (!value.trim()) return 'Full name is required'
        if (value.trim().length < 2) return 'Name must be at least 2 characters'
        if (/\d/.test(value)) return 'Name must not contain numbers'
        return ''
      case 'email':
        if (!value.trim()) return ''
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return 'Enter a valid email address'
        return ''
      case 'phone':
        if (!value.trim()) return 'Phone number is required'
        if (!/^[\d\s\+\-\(\)]{10,10}$/.test(value.replace(/\s/g, ''))) return 'Enter a valid phone number'
        return ''
      case 'eventName':
        if (!value.trim()) return 'Event name is required'
        return ''
      case 'eventDate':
        if (!value) return 'Event date is required'
        return ''
      case 'maxSelectCount':
        if (value === '' || value === null || value === undefined) return 'Max Photo Selection is required'
        if (isNaN(Number(value)))  return 'Must be a valid number'
        if (Number(value) < 0)     return 'Must be a valid number'
        if (Number(value) > 10000) return 'Cannot exceed 10000 photos'
        return ''
      default:
        return ''
    }
  }

  function validateAll(): boolean {
    const fieldKeys = ['name', 'email', 'phone', 'eventName', 'eventDate', 'maxSelectCount']
    const newErrors: FormErrors = {}
    let valid = true
    fieldKeys.forEach(key => {
      const errorMsg = validateField(key, (form as any)[key])
      if (errorMsg) { (newErrors as any)[key] = errorMsg; valid = false }
    })
    setErrors(newErrors)
    const allTouched: Record<string, boolean> = {}
    fieldKeys.forEach(key => allTouched[key] = true)
    setTouched(allTouched)
    return valid
  }

  function handleChange(key: string, value: string) {
    setForm(prev => ({ ...prev, [key]: value }))
    setTouched(prev => ({ ...prev, [key]: true }))
    const errorMsg = validateField(key, value)
    setErrors(prev => ({ ...prev, [key]: errorMsg || undefined }))
  }

  function handleBlur(key: string) {
    setTouched(prev => ({ ...prev, [key]: true }))
    const errorMsg = validateField(key, (form as any)[key])
    setErrors(prev => ({ ...prev, [key]: errorMsg || undefined }))
  }

  function openModal() {
    setForm({ name: '', email: '', phone: '', eventName: '', eventDate: '', maxSelectCount: '' })
    setErrors({})
    setTouched({})
    setShowModal(true)
  }

  async function createCustomer(e: React.FormEvent) {
    e.preventDefault()
    if (!validateAll()) return
    setSaving(true)
    try {
      const res  = await fetch('/api/admin/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(form),
      })
      const data = await res.json()
      if (!res.ok) { showToast(data.error || 'Failed to create client', 'error'); return }
      setShowModal(false)
      showToast(`Client created! Access code: ${data.accessCode}`)
      loadCustomers()
    } finally { setSaving(false) }
  }

  function handleEditChange(key: string, value: string) {
    setEditForm(prev => ({ ...prev, [key]: value }))
    setEditTouched(prev => ({ ...prev, [key]: true }))
    const msg = validateField(key, value)
    setEditErrors(prev => ({ ...prev, [key]: msg || undefined }))
  }

  function handleEditBlur(key: string) {
    setEditTouched(prev => ({ ...prev, [key]: true }))
    const msg = validateField(key, (editForm as any)[key])
    setEditErrors(prev => ({ ...prev, [key]: msg || undefined }))
  }

  function validateEditAll(): boolean {
    const fieldKeys = ['name', 'email', 'phone', 'eventName', 'eventDate','maxSelectCount']
    const newErrors: FormErrors = {}
    let valid = true
    fieldKeys.forEach(key => {
      const msg = validateField(key, (editForm as any)[key])
      if (msg) { (newErrors as any)[key] = msg; valid = false }
    })
    setEditErrors(newErrors)
    const allTouched: Record<string, boolean> = {}
    fieldKeys.forEach(key => allTouched[key] = true)
    setEditTouched(allTouched)
    return valid
  }

  function openEdit(customer: Customer) {
    setEditCustomer(customer)
    setEditForm({
      name: customer.name, email: customer.email, phone: customer.phone,
      eventName: customer.eventName, eventDate: customer.eventDate,
      maxSelectCount: String(customer.maxSelectCount ?? ''),
    })
    setEditErrors({})
    setEditTouched({})
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault()
    if (!editCustomer) return
    if (!validateEditAll()) return
    setEditSaving(true)
    try {
      const res = await fetch(`/api/admin/customers/${editCustomer.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ action: 'update', ...editForm }),
      })
      if (!res.ok) { showToast('Failed to update client', 'error'); return }
      setEditCustomer(null)
      showToast('Client updated successfully')
      loadCustomers()
    } finally { setEditSaving(false) }
  }

  async function deleteCustomer() {
    if (!confirmDelete) return
    setLoading(true)
    setConfirmDelete(null)
    await fetch(`/api/admin/customers/${confirmDelete.id}`, { method: 'DELETE', headers: authHeaders() })
    showToast('Client deleted')
    loadCustomers()
    setLoading(false)
  }

  const filteredCustomers = customers.filter(customer =>
    customer.name.toLowerCase().includes(search.toLowerCase()) ||
    customer.eventName.toLowerCase().includes(search.toLowerCase())
  )

  function getStatus(customer: Customer) {
    if (customer.isDelivered)       return 'delivered'
    if (customer.selectionLocked)   return 'locked'
    if (customer.selectedCount > 0) return 'inprogress'
    if (customer.photoCount > 0)    return 'pending'
    return 'new'
  }

  const statusStyles: Record<string, { color: string; bg: string; border: string; dot: string; label: string }> = {
    delivered:  { label: 'Completed',   bg: 'rgba(74,222,128,0.12)',  color: '#4ade80', border: 'rgba(74,222,128,0.25)',  dot: '#4ade80' },
    locked:     { label: 'Submitted',   bg: 'rgba(96,165,250,0.12)',  color: '#60a5fa', border: 'rgba(96,165,250,0.25)',  dot: '#60a5fa' },
    inprogress: { label: 'In Progress', bg: 'rgba(212,160,23,0.12)',  color: '#f0d78c', border: 'rgba(212,160,23,0.25)',  dot: '#d4a017' },
    pending:    { label: 'Pending',     bg: 'rgba(251,191,36,0.12)',  color: '#fbbf24', border: 'rgba(251,191,36,0.25)',  dot: '#fbbf24' },
    new:        { label: 'New',         bg: 'rgba(148,163,184,0.10)', color: '#94a3b8', border: 'rgba(148,163,184,0.2)', dot: '#94a3b8' },
  }

  const fields = [
    { key: 'name',           label: 'Full Name',           placeholder: 'Ramesh & Priya',     type: 'text',   required: true,  full: true },
    { key: 'email',          label: 'Email Address',       placeholder: 'ramesh@example.com', type: 'email',  required: false,  full: false },
    { key: 'phone',          label: 'Phone Number',        placeholder: '+91 98765 43210',    type: 'tel',    required: true,  full: false },
    { key: 'eventName',      label: 'Event Name',          placeholder: 'Wedding Reception',  type: 'text',   required: true,  full: false },
    { key: 'eventDate',      label: 'Event Date',          placeholder: '',                   type: 'date',   required: true,  full: false },
    { key: 'maxSelectCount', label: 'Max Photo Selection', placeholder: '',      type: 'number', required: true  , full: false },
  ]

  return (
    <div style={{ padding: '40px 48px' }}>
      {alert && <AlertModal type={alert.type} message={alert.msg} onClose={() => setAlert(null)} />}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 32 }}>
        <div>
          <h1 style={{ fontFamily: "'Playfair Display', serif", fontSize: 32, color: '#f5f0e8', marginBottom: 8 }}>Clients</h1>
          <p style={{ color: '#8a8070', fontSize: 14 }}>Manage your photography clients and photo access</p>
        </div>
        <button className="btn-gold" onClick={openModal} style={{ padding: '12px 24px', borderRadius: 10, fontSize: 14 }}>
          + New Client
        </button>
      </div>

      <div style={{ marginBottom: 22 }}>
        <input className="input-dark" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search by name or event…" style={{ padding: '11px 16px', fontSize: 14, maxWidth: 360 }} />
      </div>

      <div className="glass-card" style={{ overflow: 'hidden' }}>
        {loading ? (
          <PhotoLoader message="Loading clients…" />
        ) : filteredCustomers.length === 0 ? (
          <div style={{ padding: 60, textAlign: 'center', color: '#555' }}>
            {search ? 'No clients match your search' : 'No clients yet — add your first one!'}
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Client</th><th>Event</th><th>Access Code</th>
                <th>Photos</th><th>Selected</th><th>Status</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredCustomers.map(customer => {
                const statusStyle = statusStyles[getStatus(customer)]
                return (
                  <tr key={customer.id}>
                    <td>
                      <div style={{ fontWeight: 600, color: '#f5f0e8' }}>{customer.name}</div>
                      <div style={{ fontSize: 12, color: '#555' }}>{customer.email}</div>
                    </td>
                    <td style={{ color: '#8a8070' }}>
                      <div>{customer.eventName}</div>
                      {customer.eventDate && <div style={{ fontSize: 11, color: '#444' }}>{customer.eventDate}</div>}
                    </td>
                    <td>
                      <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#f0d78c', background: 'rgba(212,160,23,0.1)', padding: '3px 8px', borderRadius: 6 }}>
                        {customer.accessCode}
                      </span>
                    </td>
                    <td><span className="badge badge-gold">{customer.photoCount}</span></td>
                    <td>
                      <span style={{ color: '#4ade80', fontWeight: 600 }}>{customer.selectedCount}</span>
                      {customer.maxSelectCount > 0 && <span style={{ color: '#555' }}> / {customer.maxSelectCount}</span>}
                    </td>
                    <td>
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: statusStyle.bg, border: `1px solid ${statusStyle.border}`, borderRadius: 20, padding: '4px 10px' }}>
                        <div style={{ width: 6, height: 6, borderRadius: '50%', background: statusStyle.dot }} />
                        <span style={{ fontSize: 11, fontWeight: 700, color: statusStyle.color }}>{statusStyle.label}</span>
                      </div>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <Link href={`/admin/customers/${customer.id}`}>
                          <button className="btn-gold" style={{ padding: '6px 14px', borderRadius: 7, fontSize: 12 }}>Manage</button>
                        </Link>
                        <button onClick={() => openEdit(customer)} className="btn-outline"
                          style={{ padding: '6px 12px', borderRadius: 7, fontSize: 12 }}>
                          Edit
                        </button>
                        <button onClick={() => setConfirmDelete({ id: customer.id, name: customer.name })} className="btn-outline"
                          style={{ padding: '6px 12px', borderRadius: 7, fontSize: 12, color: '#f87171', borderColor: 'rgba(248,113,113,0.3)' }}>
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Delete Confirmation Modal */}
      {confirmDelete && (
        <ConfirmModal
          icon="🗑️"
          title="Delete Client?"
          message={<>This will permanently delete <span style={{ color: '#f5f0e8', fontWeight: 600 }}>{confirmDelete.name}</span> and all their photos. This action cannot be undone.</>}
          confirmLabel="Delete"
          danger
          onConfirm={deleteCustomer}
          onCancel={() => setConfirmDelete(null)}
        />
      )}

      {/* Edit Modal */}
      {editCustomer && (
        <div className="modal-overlay" onClick={() => setEditCustomer(null)}>
          <div className="glass-card" onClick={e => e.stopPropagation()} style={{ padding: 36, width: '100%', maxWidth: 520 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
              <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: 22, color: '#f5f0e8' }}>Edit Client</h2>
              <button onClick={() => setEditCustomer(null)} style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: 20 }}>✕</button>
            </div>
            <form onSubmit={saveEdit} noValidate>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                {fields.map(field => (
                  <div key={field.key} style={{ gridColumn: field.full ? 'span 2' : 'span 1' }}>
                    <label style={{ display: 'block', fontSize: 11, marginBottom: 6, letterSpacing: '0.08em', textTransform: 'uppercase',
                      color: (editErrors as any)[field.key] && editTouched[field.key] ? '#f87171' : '#8a8070' }}>
                      {field.label} {field.required && <span style={{ color: '#d4a017' }}>*</span>}
                    </label>
                    <input
                      className="input-dark"
                      type={field.type}
                      value={(editForm as any)[field.key]}
                      onChange={e => handleEditChange(field.key, e.target.value)}
                      onBlur={() => handleEditBlur(field.key)}
                      placeholder={field.placeholder}
                      min={field.key === 'maxSelectCount' ? '0' : undefined}
                      style={{
                        padding: '11px 13px', fontSize: 13,
                        borderColor: (editErrors as any)[field.key] && editTouched[field.key] ? 'rgba(248,113,113,0.5)' : undefined,
                        boxShadow:   (editErrors as any)[field.key] && editTouched[field.key] ? '0 0 0 3px rgba(248,113,113,0.1)' : undefined,
                      }}
                    />
                    {(editErrors as any)[field.key] && editTouched[field.key] && (
                      <p style={{ color: '#f87171', fontSize: 11, marginTop: 5, display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span>⚠</span> {(editErrors as any)[field.key]}
                      </p>
                    )}
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 12, marginTop: 24 }}>
                <button type="button" onClick={() => setEditCustomer(null)} className="btn-outline"
                  style={{ flex: 1, padding: '12px 0', borderRadius: 10, fontSize: 14 }}>Cancel</button>
                <button type="submit" className="btn-gold" disabled={editSaving}
                  style={{ flex: 1, padding: '12px 0', borderRadius: 10, fontSize: 14 }}>
                  {editSaving ? 'Saving…' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Create Modal */}
      {showModal && (
        <div className="modal-overlay">
          <div className="glass-card" style={{ padding: 36, width: '100%', maxWidth: 520 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
              <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: 22, color: '#f5f0e8' }}>New Client</h2>
              <button onClick={() => setShowModal(false)} style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: 20 }}>✕</button>
            </div>
            <form onSubmit={createCustomer} noValidate>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                {fields.map(field => (
                  <div key={field.key} style={{ gridColumn: field.full ? 'span 2' : 'span 1' }}>
                    <label style={{ display: 'block', fontSize: 11, marginBottom: 6, letterSpacing: '0.08em', textTransform: 'uppercase',
                      color: (errors as any)[field.key] && touched[field.key] ? '#f87171' : '#8a8070' }}>
                      {field.label} {field.required && <span style={{ color: '#d4a017' }}>*</span>}
                    </label>
                    <input
                      className="input-dark"
                      type={field.type}
                      value={(form as any)[field.key]}
                      onChange={e => handleChange(field.key, e.target.value)}
                      onBlur={() => handleBlur(field.key)}
                      placeholder={field.placeholder}
                      min={field.key === 'maxSelectCount' ? '' : undefined}
                      style={{
                        padding: '11px 13px', fontSize: 13,
                        borderColor: (errors as any)[field.key] && touched[field.key] ? 'rgba(248,113,113,0.5)' : undefined,
                        boxShadow:   (errors as any)[field.key] && touched[field.key] ? '0 0 0 3px rgba(248,113,113,0.1)' : undefined,
                      }}
                    />
                    {(errors as any)[field.key] && touched[field.key] && (
                      <p style={{ color: '#f87171', fontSize: 11, marginTop: 5, display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span>⚠</span> {(errors as any)[field.key]}
                      </p>
                    )}
                  </div>
                ))}
              </div>
              <p style={{ fontSize: 11, color: '#444', marginTop: 12, marginBottom: 20 }}>
                💡 Max Photo Selection — limits how many photos the customer can select. Leave 0 for unlimited.
              </p>
              <div style={{ display: 'flex', gap: 12 }}>
                <button type="button" onClick={() => setShowModal(false)} className="btn-outline"
                  style={{ flex: 1, padding: '12px 0', borderRadius: 10, fontSize: 14 }}>Cancel</button>
                <button type="submit" className="btn-gold" disabled={saving}
                  style={{ flex: 1, padding: '12px 0', borderRadius: 10, fontSize: 14 }}>
                  {saving ? 'Creating…' : 'Create Client'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
