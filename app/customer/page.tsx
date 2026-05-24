'use client'
import { useEffect, useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import PhotoLoader from '@/app/components/PhotoLoader'
import ConfirmModal from '@/app/components/ConfirmModal'
import AlertModal from '@/app/components/AlertModal'
import { useLogo } from '@/app/context/LogoContext'
import { authHeaders, clearSession, getCustomerId } from '@/app/utils/session'
import { useSessionGuard } from '@/app/hooks/useSessionGuard'

interface Photo {
  id: number; filename: string; originalName: string
  thumbnailUrl: string; mimeType: string; size: number
  isSelected: boolean; localPath: string; uploadedAt: string
  folderDbId: string; folderName: string
}
interface Folder { id: number; name: string; description: string; photoCount: number }
interface Customer {
  id: number; name: string; eventName: string
  photoCount: number; selectedCount: number; maxSelectCount: number
  selectionLocked: boolean; selectionLockedAt: string | null
}

export default function CustomerGallery() {
  const router = useRouter()
  const logoUrl = useLogo()
  useSessionGuard()
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [photos, setPhotos] = useState<Photo[]>([])
  const [folders, setFolders] = useState<Folder[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [saving, setSaving] = useState(false)
  const [alert, setAlert] = useState<{ msg: string; type: 'success' | 'error' | 'warning' } | null>(null)
  const [lightbox, setLightbox] = useState<{ photo: Photo; index: number } | null>(null)
  const [lightboxRotation, setLightboxRotation] = useState(0)
  const [zoom, setZoom] = useState(1)
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 })
  const [isPanning, setIsPanning] = useState(false)
  const [panStart, setPanStart] = useState({ x: 0, y: 0 })
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmSelectAll, setConfirmSelectAll] = useState(false)
  const [confirmClearAll, setConfirmClearAll] = useState(false)
  const [confirmSignOut, setConfirmSignOut] = useState(false)
  const [activeFolder, setActiveFolder] = useState<string>('all')
  const [isMobile, setIsMobile] = useState(false)
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingIdsRef = useRef<number[]>([])
  const hasPendingRef = useRef(false)
  const customerIdRef = useRef<string | null>(null)
  const touchStartPosRef = useRef({ x: 0, y: 0 })
  const touchLastPosRef = useRef({ x: 0, y: 0 })
  const touchMovedRef = useRef(false)

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  function showToast(msg: string, type: 'success' | 'error' | 'warning' = 'success') {
    setAlert({ msg, type })
  }

  // ── localStorage draft helpers ──────────────────────────────
  function lsKey(cid: string) { return `photo_selection_${cid}` }

  function saveDraftLS(cid: string, ids: number[]) {
    try { localStorage.setItem(lsKey(cid), JSON.stringify(ids)) } catch {}
  }

  function loadDraftLS(cid: string): number[] | null {
    try {
      const raw = localStorage.getItem(lsKey(cid))
      return raw ? JSON.parse(raw) : null
    } catch { return null }
  }

  function clearDraftLS(cid: string) {
    try { localStorage.removeItem(lsKey(cid)) } catch {}
  }

  async function syncToServer(ids: number[]) {
    try {
      await fetch('/api/customer/select', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ photoIds: ids }),
      })
      hasPendingRef.current = false
    } catch {}
  }

  function scheduleSync(ids: Set<number>) {
    const arr = Array.from(ids)
    pendingIdsRef.current = arr
    hasPendingRef.current = true
    if (customerIdRef.current) saveDraftLS(customerIdRef.current, arr)
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
    debounceTimerRef.current = setTimeout(() => syncToServer(arr), 800)
  }
  // ────────────────────────────────────────────────────────────

  function logout() {
    clearSession()
    router.push('/')
  }

  // Pre-load draft from localStorage immediately on mount (before server responds)
  useEffect(() => {
    const cid = getCustomerId()
    if (!cid) return
    customerIdRef.current = cid
    const draft = loadDraftLS(cid)
    if (draft && draft.length > 0) setSelected(new Set(draft))
  }, [])

  const loadGallery = useCallback(async () => {
    const r = await fetch('/api/customer/gallery', { headers: authHeaders() })
    if (r.status === 401) { router.push('/'); return }
    const data = await r.json()
    setCustomer(data.customer)
    customerIdRef.current = String(data.customer?.id ?? '')
    const folderList: Folder[] = data.folders || []
    setFolders(folderList)
    setPhotos(data.photos || [])
    const preSelected = new Set<number>((data.photos || []).filter((photo: Photo) => photo.isSelected).map((photo: Photo) => photo.id))
    // Server is authoritative — override local state
    setSelected(preSelected)
    // Only persist draft when unlocked; clear it when locked so next login starts clean
    if (customerIdRef.current) {
      if (data.customer?.selectionLocked) {
        clearDraftLS(customerIdRef.current)
      } else {
        saveDraftLS(customerIdRef.current, Array.from(preSelected))
      }
    }
    hasPendingRef.current = false
    if (debounceTimerRef.current) { clearTimeout(debounceTimerRef.current); debounceTimerRef.current = null }
    setLoading(false)
  }, [router])

  useEffect(() => { loadGallery() }, [loadGallery])

  // Flush pending sync on tab close / hard refresh (keepalive survives page unload)
  useEffect(() => {
    function onBeforeUnload() {
      if (!hasPendingRef.current) return
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
      fetch('/api/customer/select', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ photoIds: pendingIdsRef.current }),
        keepalive: true,
      }).catch(() => {})
      hasPendingRef.current = false
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])

  // Keyboard nav
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!lightbox) return
      if (e.key === 'Escape') closeLightbox()
      if (e.key === 'ArrowRight') navLightbox(1)
      if (e.key === 'ArrowLeft') navLightbox(-1)
      if (e.key === '+' || e.key === '=') setZoom(z => Math.min(5, z + 0.25))
      if (e.key === '-') setZoom(z => Math.max(1, z - 0.25))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const filteredPhotos = activeFolder === 'all' ? photos : photos.filter(p => String(p.folderDbId) === activeFolder)
  const maxCount = customer?.maxSelectCount || 0
  const atLimit = maxCount > 0 && selected.size >= maxCount
  const isLocked = customer?.selectionLocked === true

  function toggleSelect(photoId: number, e: React.MouseEvent) {
    e.stopPropagation()
    if (isLocked) return
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(photoId)) {
        next.delete(photoId)
      } else {
        if (maxCount > 0 && next.size >= maxCount) {
          showToast(`You can only select up to ${maxCount} photos`, 'error')
          return prev
        }
        next.add(photoId)
      }
      scheduleSync(next)
      return next
    })
  }

  function openLightbox(photo: Photo) {
    const idx = filteredPhotos.findIndex(p => p.id === photo.id)
    setLightbox({ photo, index: idx })
    setZoom(1)
    setPanOffset({ x: 0, y: 0 })
    setLightboxRotation(0)
    // Push one dummy entry so back button can close the lightbox
    if (!window.history.state?.lightbox) {
      window.history.pushState({ lightbox: true }, '')
    }
  }

  function closeLightbox() {
    setLightbox(null)
    setZoom(1)
    setPanOffset({ x: 0, y: 0 })
    setLightboxRotation(0)
    // Replace the dummy entry with a clean state — no backward navigation
    if (window.history.state?.lightbox) {
      window.history.replaceState(null, '')
    }
  }

  // Intercept browser back button — close lightbox instead of leaving the page
  useEffect(() => {
    function handlePopState() {
      setLightbox(prev => {
        if (prev) {
          setZoom(1)
          setPanOffset({ x: 0, y: 0 })
          setLightboxRotation(0)
        }
        return null
      })
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  function navLightbox(dir: number) {
    if (!lightbox) return
    const nextIndex = lightbox.index + dir
    if (nextIndex < 0 || nextIndex >= filteredPhotos.length) return
    setLightbox({ photo: filteredPhotos[nextIndex], index: nextIndex })
    setZoom(1); setPanOffset({ x: 0, y: 0 }); setLightboxRotation(0)
  }

  function handleWheel(e: React.WheelEvent) {
    e.preventDefault()
    setZoom(z => Math.max(1, Math.min(5, z + (e.deltaY < 0 ? 0.15 : -0.15))))
  }

  function handleMouseDown(e: React.MouseEvent) {
    if (zoom <= 1) return
    setIsPanning(true)
    setPanStart({ x: e.clientX - panOffset.x, y: e.clientY - panOffset.y })
  }

  function handleMouseMove(e: React.MouseEvent) {
    if (!isPanning) return
    setPanOffset({ x: e.clientX - panStart.x, y: e.clientY - panStart.y })
  }

  function handleMouseUp() { setIsPanning(false) }

  function handleTouchStartImage(e: React.TouchEvent) {
    if (e.touches.length !== 1) return
    const t = e.touches[0]
    touchStartPosRef.current = { x: t.clientX, y: t.clientY }
    touchLastPosRef.current = { x: t.clientX, y: t.clientY }
    touchMovedRef.current = false
  }

  function handleTouchMoveImage(e: React.TouchEvent) {
    if (e.touches.length !== 1) return
    if (zoom <= 1) return
    const t = e.touches[0]
    const dist = Math.hypot(
      t.clientX - touchStartPosRef.current.x,
      t.clientY - touchStartPosRef.current.y
    )
    if (dist > 5) touchMovedRef.current = true
    const dx = t.clientX - touchLastPosRef.current.x
    const dy = t.clientY - touchLastPosRef.current.y
    touchLastPosRef.current = { x: t.clientX, y: t.clientY }
    setPanOffset(prev => ({ x: prev.x + dx, y: prev.y + dy }))
  }

  function handleTouchEndImage() {
    // no-op: only tracks whether the touch was a pan or a tap
  }

  async function saveSelections() {
    setSaving(true)
    try {
      const photoIds = Array.from(selected)
      const localPaths = photoIds.map(pid => {
        const photo = photos.find(p => p.id === pid)
        return photo
          ? `Selected/${customer?.name || 'photos'}/${photo.folderName ? photo.folderName + '/' : ''}${photo.originalName}`
          : ''
      })
      const r = await fetch('/api/customer/select', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ photoIds, localPaths }),
      })
      const d = await r.json()
      if (!r.ok) { showToast(d.error || 'Failed to save', 'error'); return }
      if (debounceTimerRef.current) { clearTimeout(debounceTimerRef.current); debounceTimerRef.current = null }
      hasPendingRef.current = false
      if (customerIdRef.current) clearDraftLS(customerIdRef.current)
      await loadGallery()
      showToast(`${d.selectedCount} photos submitted successfully! Your selection is now locked.`)
      setConfirmOpen(false)
    } finally { setSaving(false) }
  }

  if (loading) return <PhotoLoader fullPage message="Loading your gallery" />

  const folderTabs = [{ id: 'all', name: 'All Photos', photoCount: photos.length } as any, ...folders]

  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0a' }}>
      {alert && <AlertModal type={alert.type} message={alert.msg} onClose={() => setAlert(null)} />}

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

      {/* ── Header ── */}
      <header style={{
        background: '#0d0d0d', borderBottom: '1px solid #1a1a1a',
        padding: isMobile ? '0 14px' : '0 32px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        height: isMobile ? 56 : 64,
        position: 'sticky', top: 0, zIndex: 200,
        gap: 12,
      }}>
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <div style={{
            width: 34, height: 34, borderRadius: '50%',
            background: 'linear-gradient(135deg, #d4a017, #b8860b)',
            overflow: 'hidden', flexShrink: 0,
            boxShadow: '0 2px 8px rgba(212,160,23,0.3)',
          }}><img src={logoUrl} alt="Praveen Photography" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /></div>
          <span style={{ fontFamily: "'Playfair Display', serif", color: '#f0d78c', fontSize: isMobile ? 14 : 16, fontWeight: 600, whiteSpace: 'nowrap' }}>
            Praveen Photography
          </span>
        </div>

        {/* Spacer (desktop) */}
        {!isMobile && <div style={{ flex: 1 }} />}

        {/* Right side: customer identity + Sign Out */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
          {/* Customer identity chip — desktop only */}
          {!isMobile && (
            <>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 9,
                background: 'rgba(255,255,255,0.03)', border: '1px solid #1e1e1e',
                borderRadius: 12, padding: '6px 14px',
              }}>
                <div style={{
                  width: 26, height: 26, borderRadius: '50%',
                  background: 'linear-gradient(135deg, #60a5fa, #3b82f6)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 11, fontWeight: 700, color: '#fff', flexShrink: 0,
                }}>
                  {customer?.name?.[0]?.toUpperCase() ?? 'C'}
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#f5f0e8', lineHeight: 1.2 }}>{customer?.name}</div>
                  <div style={{ fontSize: 11, color: '#555', lineHeight: 1.2 }}>{customer?.eventName}</div>
                </div>
              </div>
              <div style={{ width: 1, height: 22, background: '#1e1e1e', flexShrink: 0 }} />
            </>
          )}
          <button
            onClick={() => setConfirmSignOut(true)}
            style={{
              background: 'rgba(248,113,113,0.06)',
              border: '1px solid rgba(248,113,113,0.2)',
              cursor: 'pointer', color: '#f87171',
              borderRadius: 9, padding: isMobile ? '6px 12px' : '7px 14px',
              fontSize: 12, fontWeight: 600,
              display: 'flex', alignItems: 'center', gap: 5,
              transition: 'all 0.2s', whiteSpace: 'nowrap',
            }}
            onMouseEnter={e => { const b = e.currentTarget; b.style.background = 'rgba(248,113,113,0.14)'; b.style.borderColor = 'rgba(248,113,113,0.38)' }}
            onMouseLeave={e => { const b = e.currentTarget; b.style.background = 'rgba(248,113,113,0.06)'; b.style.borderColor = 'rgba(248,113,113,0.2)' }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
            Sign Out
          </button>
        </div>
      </header>

      {/* ── Mobile: customer name strip ── */}
      {isMobile && (
        <div style={{
          background: '#0d0d0d', borderBottom: '1px solid #1a1a1a',
          padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <div style={{
            width: 24, height: 24, borderRadius: '50%', flexShrink: 0,
            background: 'linear-gradient(135deg, #60a5fa, #3b82f6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 11, fontWeight: 700, color: '#fff',
          }}>
            {customer?.name?.[0]?.toUpperCase() ?? 'C'}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#f5f0e8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{customer?.name}</div>
          </div>
          <span style={{ fontSize: 11, color: '#555', flexShrink: 0 }}>{customer?.eventName}</span>
        </div>
      )}


      {/* ── Locked banner ── */}
      {isLocked && (
        <div style={{ background: 'rgba(96,165,250,0.08)', borderBottom: '1px solid rgba(96,165,250,0.2)', padding: isMobile ? '10px 14px' : '12px 32px', display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <span style={{ fontSize: 18, flexShrink: 0 }}>🔒</span>
          <div>
            <p style={{ fontSize: 13, fontWeight: 600, color: '#60a5fa', marginBottom: 2 }}>Your photo selection has been submitted</p>
            <p style={{ fontSize: 12, color: '#555' }}>
              You selected <strong style={{ color: '#f0d78c' }}>{customer?.selectedCount} photos</strong>.
              {customer?.selectionLockedAt && ` Submitted on ${new Date(customer.selectionLockedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}.`}
              {' '}Contact your photographer to make changes.
            </p>
          </div>
        </div>
      )}

      {/* ── Limit warning banner ── */}
      {!isLocked && atLimit && (
        <div style={{ background: 'rgba(251,191,36,0.1)', borderBottom: '1px solid rgba(251,191,36,0.2)', padding: isMobile ? '8px 14px' : '10px 32px', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 15 }}>⚠️</span>
          <span style={{ fontSize: 12, color: '#fbbf24' }}>Selection limit of <strong>{maxCount} photos</strong> reached. Deselect to swap.</span>
        </div>
      )}

      {/* ── Mobile: Folder tabs (horizontal scroll) ── */}
      {isMobile && folders.length > 0 && (
        <div style={{ background: '#0d0d0d', borderBottom: '1px solid #1a1a1a', padding: '0 14px', overflowX: 'auto', display: 'flex', gap: 6, scrollbarWidth: 'none' }}>
          <style>{`.mobile-folder-tabs::-webkit-scrollbar{display:none}`}</style>
          <div className="mobile-folder-tabs" style={{ display: 'flex', gap: 6, padding: '10px 0', flexShrink: 0 }}>
            {folderTabs.map(folder => (
              <button key={folder.id}
                onClick={() => setActiveFolder(String(folder.id))}
                style={{
                  flexShrink: 0, padding: '6px 14px', borderRadius: 20, cursor: 'pointer',
                  background: activeFolder === String(folder.id) ? 'rgba(212,160,23,0.2)' : 'rgba(255,255,255,0.05)',
                  color: activeFolder === String(folder.id) ? '#f0d78c' : '#8a8070',
                  fontSize: 12, fontFamily: "'DM Sans', sans-serif", fontWeight: activeFolder === String(folder.id) ? 600 : 400,
                  border: `1px solid ${activeFolder === String(folder.id) ? 'rgba(212,160,23,0.4)' : 'rgba(255,255,255,0.06)'}`,
                  whiteSpace: 'nowrap',
                }}>
                {folder.id === 'all' ? '📂' : '📁'} {folder.name}
                <span style={{ marginLeft: 5, fontSize: 10, color: activeFolder === String(folder.id) ? '#d4a017' : '#444' }}>
                  {folder.photoCount}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Body: sidebar + gallery ── */}
      <div style={{ display: 'flex', minHeight: `calc(100vh - ${isMobile ? 56 : 64}px)` }}>

        {/* Desktop sidebar */}
        {!isMobile && folders.length > 0 && (
          <aside style={{ width: 210, background: '#0d0d0d', borderRight: '1px solid #1a1a1a', padding: '20px 12px', flexShrink: 0, position: 'sticky', top: 64, height: 'calc(100vh - 64px)', overflowY: 'auto' }}>
            <p style={{ fontSize: 10, color: '#444', letterSpacing: '0.12em', textTransform: 'uppercase', paddingLeft: 8, marginBottom: 10 }}>Folders</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {folderTabs.map(folder => (
                <button key={folder.id}
                  onClick={() => setActiveFolder(String(folder.id))}
                  style={{
                    width: '100%', textAlign: 'left', padding: '9px 12px', borderRadius: 8, border: 'none', cursor: 'pointer',
                    background: activeFolder === String(folder.id) ? 'rgba(212,160,23,0.12)' : 'transparent',
                    color: activeFolder === String(folder.id) ? '#f0d78c' : '#8a8070',
                    fontSize: 13, fontFamily: "'DM Sans', sans-serif",
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {folder.id === 'all' ? '📂' : '📁'} {folder.name}
                  </span>
                  <span style={{ fontSize: 11, color: '#555', flexShrink: 0, marginLeft: 6 }}>{folder.photoCount}</span>
                </button>
              ))}
            </div>
          </aside>
        )}

        {/* Main gallery */}
        <main style={{ flex: 1, padding: isMobile ? '16px 12px' : '28px 32px', overflowY: 'auto' }}>

          {/* Title + badges */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
            <div>
              <h1 style={{ fontFamily: "'Playfair Display', serif", fontSize: isMobile ? 20 : 24, color: '#f5f0e8', marginBottom: 2 }}>
                {activeFolder === 'all' ? 'Your Gallery' : folders.find(f => String(f.id) === activeFolder)?.name || 'Your Gallery'}
              </h1>
              {!isMobile && <p style={{ color: '#8a8070', fontSize: 13 }}>Tap checkbox to select · Tap image to zoom</p>}
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              <span className="badge badge-gold" style={{ fontSize: 11 }}>{filteredPhotos.length} photos</span>
              {maxCount > 0 && (
                <span className="badge" style={{
                  fontSize: 11,
                  background: atLimit ? 'rgba(251,191,36,0.15)' : 'rgba(74,222,128,0.1)',
                  color: atLimit ? '#fbbf24' : '#4ade80',
                  border: `1px solid ${atLimit ? 'rgba(251,191,36,0.3)' : 'rgba(74,222,128,0.2)'}`,
                }}>
                  {selected.size}/{maxCount}
                </span>
              )}
            </div>
          </div>

          {/* Action buttons */}
          {filteredPhotos.length > 0 && !isLocked && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
              <button onClick={() => setConfirmSelectAll(true)} className="btn-outline" style={{ padding: '7px 14px', borderRadius: 8, fontSize: 12 }}>Select All</button>
              <button onClick={() => setConfirmClearAll(true)} className="btn-outline" style={{ padding: '7px 14px', borderRadius: 8, fontSize: 12 }}>Clear All</button>
              {selected.size > 0 && (
                <button onClick={() => setConfirmOpen(true)} className="btn-gold" style={{ padding: '7px 18px', borderRadius: 8, fontSize: 12 }}>
                  ✓ Submit {selected.size} Photo{selected.size !== 1 ? 's' : ''}
                </button>
              )}
            </div>
          )}

          {/* Locked notice */}
          {isLocked && filteredPhotos.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 16, background: 'rgba(96,165,250,0.06)', border: '1px solid rgba(96,165,250,0.15)', borderRadius: 10, padding: '12px 14px' }}>
              <span style={{ fontSize: 16, flexShrink: 0 }}>🔒</span>
              <div>
                <p style={{ fontSize: 13, color: '#60a5fa', fontWeight: 600, marginBottom: 2 }}>Selection locked — view only</p>
                <p style={{ fontSize: 12, color: '#555' }}>Selected photos are highlighted in gold. Contact your photographer to make changes.</p>
              </div>
            </div>
          )}

          {/* Photo grid */}
          {filteredPhotos.length === 0 ? (
            <div style={{ textAlign: 'center', paddingTop: 60 }}>
              <div style={{ fontSize: 48, marginBottom: 14 }}>📸</div>
              <p style={{ color: '#555', fontSize: 15 }}>No photos here yet — check back soon!</p>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(auto-fill, minmax(130px, 1fr))' : 'repeat(auto-fill, minmax(180px, 1fr))', gap: isMobile ? 7 : 10 }}>
              {filteredPhotos.map(photo => {
                const isSel = selected.has(photo.id)
                const isDisabled = !isSel && (atLimit || isLocked)
                return (
                  <div key={photo.id}
                    style={{
                      position: 'relative', borderRadius: 10, overflow: 'hidden', aspectRatio: '1',
                      background: '#111',
                      outline: isSel ? '3px solid #d4a017' : '3px solid transparent',
                      outlineOffset: '-3px',
                      transition: 'transform 0.15s, outline 0.15s, opacity 0.15s',
                      transform: isSel ? 'scale(0.97)' : 'scale(1)',
                      opacity: isLocked && !isSel ? 0.45 : isDisabled ? 0.5 : 1,
                      cursor: 'pointer',
                    }}
                    onClick={() => openLightbox(photo)}
                  >
                    <img
                      src={photo.thumbnailUrl}
                      alt={photo.originalName}
                      style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', userSelect: 'none' }}
                      loading="lazy"
                      draggable={false}
                    />

                    {/* Watermark */}
                    <div style={{
                      position: 'absolute', bottom: 5, right: 6,
                      fontFamily: "'Playfair Display', serif", fontSize: 8, fontWeight: 700,
                      color: 'rgba(255,255,255,0.5)', letterSpacing: '0.05em',
                      textShadow: '0 1px 4px rgba(0,0,0,0.95)', pointerEvents: 'none', whiteSpace: 'nowrap',
                    }}>© Praveen Photography</div>

                    {/* Checkbox */}
                    {!isLocked ? (
                      <div
                        onClick={e => toggleSelect(photo.id, e)}
                        style={{
                          position: 'absolute', top: 7, right: 7,
                          width: isMobile ? 26 : 22, height: isMobile ? 26 : 22, borderRadius: 6,
                          background: isSel ? '#d4a017' : 'rgba(0,0,0,0.55)',
                          border: `2px solid ${isSel ? '#d4a017' : 'rgba(255,255,255,0.4)'}`,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          cursor: isDisabled ? 'not-allowed' : 'pointer',
                          transition: 'all 0.15s', zIndex: 5,
                          backdropFilter: 'blur(4px)',
                        }}
                        title={isDisabled ? `Max ${maxCount} photos allowed` : isSel ? 'Deselect' : 'Select'}>
                        {isSel && <span style={{ color: '#0a0a0a', fontSize: isMobile ? 14 : 13, fontWeight: 800, lineHeight: 1 }}>✓</span>}
                      </div>
                    ) : isSel ? (
                      <div style={{
                        position: 'absolute', top: 7, right: 7,
                        width: 22, height: 22, borderRadius: 6,
                        background: '#d4a017', border: '2px solid #d4a017',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 5,
                      }}>
                        <span style={{ color: '#0a0a0a', fontSize: 13, fontWeight: 800, lineHeight: 1 }}>✓</span>
                      </div>
                    ) : null}

                    {/* {photo.isSelected && !isSel && (
                      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, background: 'rgba(74,222,128,0.18)', padding: '3px 0', fontSize: 9, color: '#4ade80', textAlign: 'center', letterSpacing: '0.05em', fontWeight: 700 }}>SAVED</div>
                    )} */}
                  </div>
                )
              })}
            </div>
          )}
        </main>
      </div>

      {/* Floating counter */}
      {photos.length > 0 && (
        <div className="floating-counter" style={isLocked ? { background: 'linear-gradient(135deg, #2563eb, #1d4ed8)' } : {}}>
          {isLocked ? '🔒' : '🖼'} {photos.length} · ✅ {isLocked ? customer?.selectedCount : selected.size}{maxCount > 0 ? `/${maxCount}` : ''}
          {isLocked && <span style={{ fontSize: 10, marginLeft: 4, opacity: 0.8 }}>Submitted</span>}
        </div>
      )}

      {/* Confirm modal */}
      {confirmOpen && !isLocked && (
        <div className="modal-overlay" onClick={() => setConfirmOpen(false)}>
          <div className="glass-card" onClick={e => e.stopPropagation()} style={{ padding: isMobile ? 24 : 36, maxWidth: 400, width: '92%', textAlign: 'center' }}>
            <div style={{ fontSize: 44, marginBottom: 14 }}>📦</div>
            <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: isMobile ? 20 : 22, color: '#f5f0e8', marginBottom: 10 }}>Submit Your Selection</h2>
            <p style={{ color: '#8a8070', fontSize: 14, marginBottom: 8 }}>
              You are submitting <strong style={{ color: '#f0d78c' }}>{selected.size} photos</strong> as your final selection.
            </p>
            <div style={{ background: 'rgba(96,165,250,0.08)', border: '1px solid rgba(96,165,250,0.2)', borderRadius: 10, padding: '12px 14px', marginBottom: 20, textAlign: 'left' }}>
              <p style={{ fontSize: 12, color: '#60a5fa', fontWeight: 600, marginBottom: 4 }}>⚠️ This action will lock your selection</p>
              <p style={{ fontSize: 12, color: '#555' }}>Once submitted, you cannot change your selection unless your photographer resets it.</p>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setConfirmOpen(false)} className="btn-outline" style={{ flex: 1, padding: '12px 0', borderRadius: 10, fontSize: 14 }}>Go Back</button>
              <button onClick={saveSelections} className="btn-gold" disabled={saving} style={{ flex: 1, padding: '12px 0', borderRadius: 10, fontSize: 14 }}>
                {saving ? (
                  <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                    <span style={{ width: 14, height: 14, border: '2px solid rgba(0,0,0,0.3)', borderTopColor: '#0a0a0a', borderRadius: '50%', display: 'inline-block', animation: 'spin 0.7s linear infinite' }} />
                    Submitting…
                  </span>
                ) : '🔒 Submit'}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmSelectAll && (
        <ConfirmModal
          icon="☑️"
          title="Select All Photos"
          message={`This will select ${maxCount > 0 ? `up to ${maxCount}` : 'all'} photos. Are you sure?`}
          confirmLabel="Select All"
          cancelLabel="Cancel"
          onConfirm={() => {
            const next = new Set(maxCount > 0 ? filteredPhotos.slice(0, maxCount).map(p => p.id) : photos.map(p => p.id))
            setSelected(next)
            scheduleSync(next)
            if (maxCount > 0 && filteredPhotos.length > maxCount) showToast(`Limited to ${maxCount} photos max`, 'error')
            setConfirmSelectAll(false)
          }}
          onCancel={() => setConfirmSelectAll(false)}
        />
      )}

      {confirmClearAll && (
        <ConfirmModal
          icon="🗑️"
          title="Clear All Selections"
          message="This will remove all your selected photos. Are you sure?"
          confirmLabel="Clear All"
          cancelLabel="Cancel"
          danger
          onConfirm={() => {
            const next = new Set<number>()
            setSelected(next)
            scheduleSync(next)
            setConfirmClearAll(false)
          }}
          onCancel={() => setConfirmClearAll(false)}
        />
      )}

      {/* Lightbox */}
      {lightbox && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.97)', zIndex: 9999, display: 'flex', flexDirection: 'column' }}
          onClick={closeLightbox}
        >
          {/* Top bar */}
          <div onClick={e => e.stopPropagation()}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: isMobile ? '10px 14px' : '12px 20px', background: 'rgba(0,0,0,0.6)', borderBottom: '1px solid #1a1a1a', flexShrink: 0 }}>

            {/* Left: name + position */}
            <div style={{ minWidth: 0, flex: 1 }}>
              {!isMobile && <p style={{ color: '#f5f0e8', fontSize: 13, fontWeight: 600, marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{lightbox.photo.originalName}</p>}
              <p style={{ color: '#555', fontSize: 11 }}>{lightbox.index + 1} / {filteredPhotos.length}</p>
            </div>

            {/* Center: zoom controls — desktop only */}
            {!isMobile && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 20, paddingRight: 20 }}>
                <button onClick={() => setZoom(z => Math.max(1, z - 0.25))}
                  style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', color: '#f0d78c', borderRadius: 8, width: 36, height: 36, cursor: 'pointer', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>−</button>
                <div style={{ background: '#111', border: '1px solid #2a2a2a', borderRadius: 8, padding: '6px 14px', minWidth: 68, textAlign: 'center' }}>
                  <span style={{ color: '#f0d78c', fontSize: 13, fontWeight: 600 }}>{Math.round(zoom * 100)}%</span>
                </div>
                <button onClick={() => setZoom(z => Math.min(5, z + 0.25))}
                  style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', color: '#f0d78c', borderRadius: 8, width: 36, height: 36, cursor: 'pointer', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>+</button>
                <button onClick={() => { setZoom(1); setPanOffset({ x: 0, y: 0 }) }}
                  style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', color: '#8a8070', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontSize: 12, fontFamily: "'DM Sans', sans-serif" }}>Reset</button>
              </div>
            )}

            {/* Right: rotate + divider + select + close */}
            <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 8 : 10, justifyContent: 'flex-end', flex: isMobile ? 1 : 'unset' }}>
              <button
                onClick={e => { e.stopPropagation(); setLightboxRotation(r => (r + 90) % 360) }}
                title="Rotate 90°"
                style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', color: '#8a8070', borderRadius: 8, width: isMobile ? 40 : 36, height: isMobile ? 40 : 36, cursor: 'pointer', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>↻</button>
              <div style={{ width: 1, height: 24, background: '#2a2a2a', flexShrink: 0 }} />
              <button
                onClick={e => { e.stopPropagation(); if (!isLocked) toggleSelect(lightbox.photo.id, e as any) }}
                disabled={isLocked || (!selected.has(lightbox.photo.id) && atLimit)}
                style={{
                  background: selected.has(lightbox.photo.id) ? 'rgba(212,160,23,0.2)' : '#1a1a1a',
                  border: `1px solid ${selected.has(lightbox.photo.id) ? '#d4a017' : '#2a2a2a'}`,
                  color: isLocked ? '#555' : selected.has(lightbox.photo.id) ? '#f0d78c' : '#8a8070',
                  borderRadius: 8, padding: isMobile ? '8px 14px' : '7px 16px',
                  cursor: isLocked ? 'not-allowed' : 'pointer',
                  fontSize: isMobile ? 14 : 13, fontFamily: "'DM Sans', sans-serif",
                  opacity: (isLocked || (!selected.has(lightbox.photo.id) && atLimit)) ? 0.4 : 1,
                  display: 'flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap',
                }}>
                {isLocked ? '🔒' : selected.has(lightbox.photo.id) ? '✓ Selected' : 'Select'}
              </button>
              <button onClick={closeLightbox}
                style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', color: '#8a8070', borderRadius: 8, width: isMobile ? 40 : 36, height: isMobile ? 40 : 36, cursor: 'pointer', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
            </div>
          </div>

          {/* Image area */}
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', overflow: 'hidden' }}>
            {lightbox.index > 0 && (
              <button onClick={e => { e.stopPropagation(); navLightbox(-1) }}
                style={{ position: 'absolute', left: isMobile ? 8 : 16, zIndex: 10, background: 'rgba(0,0,0,0.6)', border: '1px solid #2a2a2a', color: '#f5f0e8', borderRadius: 12, width: isMobile ? 40 : 48, height: isMobile ? 40 : 48, cursor: 'pointer', fontSize: isMobile ? 20 : 24, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>‹</button>
            )}
            {lightbox.index < filteredPhotos.length - 1 && (
              <button onClick={e => { e.stopPropagation(); navLightbox(1) }}
                style={{ position: 'absolute', right: isMobile ? 8 : 16, zIndex: 10, background: 'rgba(0,0,0,0.6)', border: '1px solid #2a2a2a', color: '#f5f0e8', borderRadius: 12, width: isMobile ? 40 : 48, height: isMobile ? 40 : 48, cursor: 'pointer', fontSize: isMobile ? 20 : 24, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>›</button>
            )}

            <div onClick={e => e.stopPropagation()}
              onWheel={handleWheel}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
              onTouchStart={handleTouchStartImage}
              onTouchMove={handleTouchMoveImage}
              onTouchEnd={handleTouchEndImage}
              style={{ cursor: zoom > 1 ? (isPanning ? 'grabbing' : 'grab') : 'default', touchAction: zoom > 1 ? 'none' : 'auto', position: 'relative' }}>
              <div style={{
                transform: `scale(${zoom}) translate(${panOffset.x / zoom}px, ${panOffset.y / zoom}px)`,
                transition: isPanning ? 'none' : 'transform 0.12s ease',
                transformOrigin: 'center',
              }}>
                <img
                  src={lightbox.photo.thumbnailUrl}
                  alt={lightbox.photo.originalName}
                  style={{
                    maxWidth: (lightboxRotation === 90 || lightboxRotation === 270)
                      ? 'calc(100vh - 130px)'
                      : (isMobile ? '96vw' : 'min(88vw, 1100px)'),
                    maxHeight: (lightboxRotation === 90 || lightboxRotation === 270)
                      ? (isMobile ? '96vw' : 'min(88vw, 1100px)')
                      : 'calc(100vh - 130px)',
                    objectFit: 'contain', display: 'block',
                    borderRadius: zoom === 1 ? 8 : 0,
                    transform: `rotate(${lightboxRotation}deg)`,
                    transition: 'transform 0.25s ease',
                  }}
                  draggable={false}
                />
                <div style={{
                  position: 'absolute', bottom: 8, right: 10,
                  fontFamily: "'Playfair Display', serif", fontSize: isMobile ? 10 : 12, fontWeight: 700,
                  color: 'rgba(255,255,255,0.4)', letterSpacing: '0.07em',
                  textShadow: '0 1px 5px rgba(0,0,0,0.99)', pointerEvents: 'none', whiteSpace: 'nowrap',
                }}>© Praveen Photography</div>
              </div>
            </div>
          </div>

          {/* Bottom bar — zoom controls on mobile, hint text on desktop */}
          <div onClick={e => e.stopPropagation()}
            style={{ padding: isMobile ? '10px 20px' : '7px 16px', background: 'rgba(0,0,0,0.7)', borderTop: '1px solid #1e1e1e', flexShrink: 0, backdropFilter: 'blur(8px)' }}>
            <p style={{ color: '#333', fontSize: 10, textAlign: 'center' }}>
              {isMobile ? '← → to navigate' : 'Scroll to zoom · Drag to pan · ← → to navigate · Esc to close'}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
