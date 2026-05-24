'use client'
import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import ConfirmModal from '@/app/components/ConfirmModal'
import AlertModal from '@/app/components/AlertModal'
import PhotoLoader from '@/app/components/PhotoLoader'
import { authHeaders } from '@/app/utils/session'

interface Customer {
  id: number; name: string; email: string; phone: string
  eventName: string; eventDate: string; accessCode: string
  photoCount: number; selectedCount: number; maxSelectCount: number
  selectionLocked: boolean; selectionLockedAt: string | null
}
interface Folder {
  id: number; name: string; description: string
  photoCount: number; localSourcePath: string
}
interface Photo {
  id: number; originalName: string; mimeType: string; size: number
  thumbnailUrl: string; isSelected: boolean; folderDbId: string
  folderName: string; savedToFolder: boolean; uploadedAt: string
}

declare global {
  interface Window {
    showDirectoryPicker?: (opts?: any) => Promise<FileSystemDirectoryHandle>
  }
}

// ─── Session-level handle store ─────────────────────────────────────────────
// Maps folderDbId → { dirHandle, fileMap }
// dirHandle: the picked directory
// fileMap: filename → FileSystemFileHandle (for reading full-res during save)
type FolderSession = {
  dirHandle: FileSystemDirectoryHandle
  fileMap: Record<string, FileSystemFileHandle>
}
const sessionStore: Record<string, FolderSession> = {}

// Maps folderDbId → filename → File (for photos uploaded directly via file input)
const uploadedFilesMap: Record<string, Record<string, File>> = {}

// ─── IndexedDB persistence for FileSystemDirectoryHandle ────────────────────
// Allows restoring the source folder across page reloads without re-browsing.
const IDB_NAME  = 'praveen-photo-admin'
const IDB_STORE = 'folder-handles'

function openHandleDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 2)
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result
      if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror   = () => reject(req.error)
  })
}

async function saveHandleToIDB(key: string, handle: FileSystemDirectoryHandle): Promise<void> {
  try {
    const db = await openHandleDB()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite')
      tx.objectStore(IDB_STORE).put(handle, key)
      tx.oncomplete = () => resolve()
      tx.onerror    = () => reject(tx.error)
    })
  } catch { /* non-fatal */ }
}

async function getHandleFromIDB(key: string): Promise<FileSystemDirectoryHandle | null> {
  try {
    const db = await openHandleDB()
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly')
      const req = tx.objectStore(IDB_STORE).get(key)
      req.onsuccess = () => resolve(req.result ?? null)
      req.onerror   = () => reject(req.error)
    })
  } catch { return null }
}

// ─── Pipeline uploader ───────────────────────────────────────────────────────
// Generates thumbnails (concurrency=10) and fires API batch calls (size=20).
// Failed photos are retried up to 3 times before being reported as failures.
type ThumbEntry = { originalName: string; mimeType: string; size: number; thumbnailData: string }

async function pipelineUpload(
  imageFiles: File[],
  customerId: string,
  folderDbId: number,
  onProgress: (done: number, total: number, phase: string) => void,
  cancelRef: { cancelled: boolean }
): Promise<{ uploaded: number; failedNames: string[]; insertedIds: number[]; networkError: boolean }> {
  const BATCH_SIZE = 10
  const THUMB_CONCURRENCY = 10
  const API_CONCURRENCY = 8
  const MAX_RETRIES = 5

  const total = imageFiles.length
  let thumbsDone = 0
  let uploadedCount = 0
  const allFailedNames: string[] = []
  const allInsertedIds: number[] = []
  let networkError = false

  let buffer: ThumbEntry[] = []
  const uploadPromises: Promise<void>[] = []
  let activeUploads = 0

  function isNetworkError(err: unknown): boolean {
    if (!navigator.onLine) return true
    if (err instanceof TypeError) return true // "Failed to fetch"
    if (err instanceof Error && /network|fetch|offline|internet/i.test(err.message)) return true
    return false
  }

  async function sendBatch(batch: ThumbEntry[], attempt = 0): Promise<void> {
    if (cancelRef.cancelled) return
    try {
      const r = await fetch('/api/admin/photos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ customerId, folderDbId, photos: batch }),
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const d = await r.json()
      uploadedCount += d.uploaded || 0
      allInsertedIds.push(...(d.insertedIds || []))

      if (d.failedFiles?.length) {
        const failedEntries = batch.filter(e => (d.failedFiles as string[]).includes(e.originalName))
        if (attempt < MAX_RETRIES) {
          await new Promise(res => setTimeout(res, 300 * Math.pow(2, attempt)))
          await sendBatch(failedEntries, attempt + 1)
        } else {
          allFailedNames.push(...d.failedFiles)
        }
      }
    } catch (err) {
      if (isNetworkError(err)) networkError = true
      if (attempt < MAX_RETRIES) {
        await new Promise(res => setTimeout(res, 400 * Math.pow(2, attempt)))
        await sendBatch(batch, attempt + 1)
      } else {
        allFailedNames.push(...batch.map(e => e.originalName))
      }
    }
  }

  async function flushBatch(batch: ThumbEntry[]) {
    if (cancelRef.cancelled) return
    while (activeUploads >= API_CONCURRENCY) {
      if (cancelRef.cancelled) return
      await new Promise(r => setTimeout(r, 50))
    }
    activeUploads++
    try {
      await sendBatch(batch)
    } finally {
      activeUploads--
    }
  }

  let next = 0
  async function thumbWorker() {
    while (next < imageFiles.length) {
      if (cancelRef.cancelled) break
      const file = imageFiles[next++]
      const thumbBase64 = await generateThumbnail(file)
      thumbsDone++
      onProgress(thumbsDone, total, 'Generating & uploading…')

      buffer.push({ originalName: file.name, mimeType: file.type, size: file.size, thumbnailData: thumbBase64 })

      if (!cancelRef.cancelled && buffer.length >= BATCH_SIZE) {
        const batch = buffer.splice(0, BATCH_SIZE)
        uploadPromises.push(flushBatch(batch))
      }
    }
  }

  const workers = Array.from({ length: Math.min(THUMB_CONCURRENCY, imageFiles.length) }, thumbWorker)
  await Promise.all(workers)

  if (!cancelRef.cancelled && buffer.length > 0) {
    uploadPromises.push(flushBatch(buffer))
  }

  await Promise.all(uploadPromises)
  return { uploaded: uploadedCount, failedNames: allFailedNames, insertedIds: allInsertedIds, networkError }
}

// ─── Client-side thumbnail generator ────────────────────────────────────────
// Reads the File object, draws it onto a canvas at max 300×300px,
// exports as JPEG quality 0.35 → ~10-30 KB
async function generateThumbnail(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      const MAX = 900
      let { width, height } = img
      if (width > MAX || height > MAX) {
        if (width > height) { height = Math.round((height / width) * MAX); width = MAX }
        else { width = Math.round((width / height) * MAX); height = MAX }
      }
      const canvas = document.createElement('canvas')
      canvas.width = width; canvas.height = height
      const ctx = canvas.getContext('2d')!
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(img, 0, 0, width, height)
      URL.revokeObjectURL(url)
      const dataUrl = canvas.toDataURL('image/jpeg', 0.70)
      resolve(dataUrl.split(',')[1]) // return base64 portion only
    }
    img.onerror = reject
    img.src = url
  })
}

export default function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>()
  console.log("id:", id);
  
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [folders, setFolders] = useState<Folder[]>([])
  const [photos, setPhotos] = useState<Photo[]>([])
  const [loading, setLoading] = useState(true)
  const [activeFolder, setActiveFolder] = useState<Folder | null>(null)
  const [processing, setProcessing] = useState(false)
  const [processProgress, setProcessProgress] = useState({ current: 0, total: 0, phase: '' })
  const [saving, setSaving] = useState(false)
  const [saveProgress, setSaveProgress] = useState({ current: 0, total: 0 })
  const [resetting, setResetting] = useState(false)
  const [alert, setAlert] = useState<{ msg: string; type: 'success' | 'error' | 'warning' } | null>(null)
  const [showFolderModal, setShowFolderModal] = useState(false)
  const [folderForm, setFolderForm] = useState({ name: '', description: '' })
  const [savingFolder, setSavingFolder] = useState(false)
  const [fsSupportError, setFsSupportError] = useState(false)
  const [sourceNotFoundError, setSourceNotFoundError] = useState(false)
  const [linkedLabels, setLinkedLabels] = useState<Record<string, string>>({}) // folderId → dir name
  const [uploadMode, setUploadMode] = useState<'folder' | 'files'>('folder')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [confirmDeleteFolder, setConfirmDeleteFolder] = useState<Folder | null>(null)
  const [confirmReset, setConfirmReset] = useState(false)
  const [photoViewModal, setPhotoViewModal] = useState<'all' | 'selected' | null>(null)
  const [modalLightbox, setModalLightbox] = useState<{ list: Photo[]; index: number } | null>(null)
  const [cancelInProgress, setCancelInProgress] = useState(false)
  const uploadCancelRef = useRef({ cancelled: false })
  const [adminRotation, setAdminRotation] = useState(0)
  const [totalPhotos, setTotalPhotos] = useState(0)
  const UPLOAD_LIMIT = Number(process.env.NEXT_PUBLIC_UPLOAD_PHOTO_LIMIT) || 100000

  function showToast(msg: string, type: 'success' | 'error' | 'warning' = 'success') {
    if (msg.startsWith('📂')) return // skip picker-instruction hints — the OS dialog is self-explanatory
    setAlert({ msg, type })
  }

  const load = useCallback(async () => {
    setLoading(true)
    const [customerRes, folderRes, statsRes] = await Promise.all([
      fetch(`/api/admin/customers/${id}`, { headers: authHeaders() }),
      fetch(`/api/admin/folders?customerId=${id}`, { headers: authHeaders() }),
      fetch('/api/admin/stats', { headers: authHeaders() }),
    ])
    if (customerRes.ok) { const data = await customerRes.json(); setCustomer(data.customer); setPhotos(data.photos || []) }
    if (folderRes.ok) {
      const list: Folder[] = await folderRes.json()
      setFolders(Array.isArray(list) ? list : [])
      setActiveFolder(prev => prev ? (list.find(folder => folder.id === prev.id) || list[0] || null) : (list[0] || null))
    }
    if (statsRes.ok) { const s = await statsRes.json(); setTotalPhotos(s.totalPhotos ?? 0) }
    setLoading(false)
  }, [id])

  useEffect(() => { load() }, [load])

  // ─── Create folder ────────────────────────────────────────────────────────
  async function createFolder(e: React.FormEvent) {
    e.preventDefault()
    setSavingFolder(true)
    try {
      const res = await fetch('/api/admin/folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ customerId: id, ...folderForm }),
      })
      if (!res.ok) { showToast('Failed to create folder', 'error'); return }
      const newFolder: Folder = await res.json()
      showToast(`Folder "${newFolder.name}" created`)
      setShowFolderModal(false)
      setFolderForm({ name: '', description: '' })
      await load()
      setActiveFolder(newFolder)
    } finally { setSavingFolder(false) }
  }

  function deleteFolder(folder: Folder) {
    setConfirmDeleteFolder(folder)
  }

  async function executeDeleteFolder() {
    if (!confirmDeleteFolder) return
    const folder = confirmDeleteFolder
    setConfirmDeleteFolder(null)
    setLoading(true)
    await fetch(`/api/admin/folders?folderId=${folder.id}`, { method: 'DELETE', headers: authHeaders() })
    delete sessionStore[String(folder.id)]
    setLinkedLabels(prev => { const updated = { ...prev }; delete updated[String(folder.id)]; return updated })
    if (activeFolder?.id === folder.id) setActiveFolder(null)
    showToast('Folder deleted')
    load()
    setLoading(false)
  }

  // ─── Pick folder → generate thumbnails in browser → send metadata to DB ──
  async function pickFolderAndProcess() {
    if (!activeFolder) { showToast('Select a folder first', 'error'); return }
    if (totalPhotos >= UPLOAD_LIMIT) { showToast(`Storage limit reached (${UPLOAD_LIMIT.toLocaleString()} photos). Cannot upload more photos.`, 'warning'); return }
    if (!window.showDirectoryPicker) { setFsSupportError(true); return }

    let dirHandle: FileSystemDirectoryHandle
    try {
      dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' })
    } catch { return }

    // Build a map of filename → FileSystemFileHandle
    const fileMap: Record<string, FileSystemFileHandle> = {}
    const imageFiles: File[] = []
    for await (const entry of (dirHandle as any).values()) {
      if (entry.kind === 'file') {
        const file: File = await (entry as FileSystemFileHandle).getFile()
        if (file.type.startsWith('image/')) {
          imageFiles.push(file)
          fileMap[file.name] = entry as FileSystemFileHandle
        }
      }
    }

    if (!imageFiles.length) { showToast('No images found in that folder', 'error'); return }

    if (totalPhotos + imageFiles.length > UPLOAD_LIMIT) {
      const remaining = UPLOAD_LIMIT - totalPhotos
      showToast(`This upload (${imageFiles.length.toLocaleString()} photos) would exceed the storage limit of ${UPLOAD_LIMIT.toLocaleString()}. Only ${remaining.toLocaleString()} slot${remaining === 1 ? '' : 's'} remaining.`, 'warning')
      return
    }

    // Store session (for later full-res copy) and persist handle across reloads
    sessionStore[String(activeFolder.id)] = { dirHandle, fileMap }
    setLinkedLabels(prev => ({ ...prev, [String(activeFolder.id)]: dirHandle.name }))
    await saveHandleToIDB(String(activeFolder.id), dirHandle)

    // Persist path label to DB
    await fetch('/api/admin/folders', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ folderId: activeFolder.id, localSourcePath: dirHandle.name }),
    })

    // ── Pipeline: generate thumbnails + upload batches concurrently ──────────
    uploadCancelRef.current = { cancelled: false }
    setProcessing(true)
    setProcessProgress({ current: 0, total: imageFiles.length, phase: 'Generating & uploading…' })

    const { uploaded, failedNames, insertedIds, networkError } = await pipelineUpload(
      imageFiles, id, activeFolder.id,
      (done, total, phase) => setProcessProgress({ current: done, total, phase }),
      uploadCancelRef.current
    )

    setProcessing(false)
    setCancelInProgress(false)
    setProcessProgress({ current: 0, total: 0, phase: '' })

    if (uploadCancelRef.current.cancelled) {
      if (insertedIds.length > 0) {
        try {
          await fetch('/api/admin/photos', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json', ...authHeaders() },
            body: JSON.stringify({ photoIds: insertedIds }),
          })
        } catch {}
      }
      showToast(`Upload cancelled. ${insertedIds.length > 0 ? `${insertedIds.length} partial photo(s) removed.` : ''}`)
      load()
      return
    }

    if (networkError && failedNames.length > 0) {
      showToast('Upload cancelled due to unstable internet. Please check your connection and try again.', 'error')
    } else if (failedNames.length > 0) {
      showToast(`⚠️ ${uploaded} uploaded, ${failedNames.length} failed after retries: ${failedNames.slice(0, 3).join(', ')}${failedNames.length > 3 ? '…' : ''}`, 'error')
    } else {
      showToast(`✅ ${uploaded} photos registered. Full-res files remain on your disk.`)
    }
    load()
  }

  // ─── Upload individual files → generate thumbnails → send metadata to DB ─
  async function uploadFilesAndProcess(files: FileList | null) {
    if (!activeFolder) { showToast('Select a folder first', 'error'); return }
    if (totalPhotos >= UPLOAD_LIMIT) { showToast(`Storage limit reached (${UPLOAD_LIMIT.toLocaleString()} photos). Cannot upload more photos.`, 'warning'); return }
    if (!files || !files.length) return

    const imageFiles: File[] = Array.from(files).filter(f => f.type.startsWith('image/'))
    if (!imageFiles.length) { showToast('No image files selected', 'error'); return }

    if (totalPhotos + imageFiles.length > UPLOAD_LIMIT) {
      const remaining = UPLOAD_LIMIT - totalPhotos
      showToast(`This upload (${imageFiles.length.toLocaleString()} photos) would exceed the storage limit of ${UPLOAD_LIMIT.toLocaleString()}. Only ${remaining.toLocaleString()} slot${remaining === 1 ? '' : 's'} remaining.`, 'warning')
      return
    }

    // Extract folder name from webkitRelativePath (e.g. "traditional/image21.jpg" → "traditional")
    const firstRelative = (imageFiles[0] as any).webkitRelativePath as string | undefined
    const folderHint = firstRelative ? firstRelative.split('/')[0] : null

    // Store File objects for reading during save (in-session only)
    if (!uploadedFilesMap[String(activeFolder.id)]) uploadedFilesMap[String(activeFolder.id)] = {}
    for (const file of imageFiles) {
      uploadedFilesMap[String(activeFolder.id)][file.name] = file
    }

    // Try to restore existing dir handle from IDB
    const folderId = String(activeFolder.id)
    let dirHandle: FileSystemDirectoryHandle | null = await getHandleFromIDB(folderId)
    
    // First check if already in session store (faster)
    if (!dirHandle && sessionStore[folderId]?.dirHandle) {
      dirHandle = sessionStore[folderId].dirHandle
    }
    
    // If we have a handle, verify/request permission
    if (dirHandle) {
      try {
        const perm = await (dirHandle as any).queryPermission({ mode: 'readwrite' })
        if (perm !== 'granted') {
          const req = await (dirHandle as any).requestPermission({ mode: 'readwrite' })
          if (req !== 'granted') dirHandle = null
        }
      } catch { dirHandle = null }
    }



    // Build fileMap from the dirHandle so save can use it for full-res access
    if (dirHandle) {
      const fileMap: Record<string, FileSystemFileHandle> = {}
      for await (const entry of (dirHandle as any).values()) {
        if (entry.kind === 'file') {
          const f: File = await (entry as FileSystemFileHandle).getFile()
          if (f.type.startsWith('image/')) fileMap[f.name] = entry as FileSystemFileHandle
        }
      }
      sessionStore[folderId] = { dirHandle, fileMap }
      setLinkedLabels(prev => ({ ...prev, [folderId]: dirHandle.name }))
    } else {
      if (!sessionStore[folderId]) sessionStore[folderId] = { dirHandle: null as any, fileMap: {} }
      const sourceName = folderHint || `${imageFiles.length} photos`
      setLinkedLabels(prev => ({ ...prev, [folderId]: sourceName }))
    }

    uploadCancelRef.current = { cancelled: false }
    setProcessing(true)
    setProcessProgress({ current: 0, total: imageFiles.length, phase: 'Generating & uploading…' })
    const { uploaded, failedNames, insertedIds, networkError } = await pipelineUpload(
      imageFiles, id, activeFolder.id,
      (done, total, phase) => setProcessProgress({ current: done, total, phase }),
      uploadCancelRef.current
    )
    setProcessing(false)
    setCancelInProgress(false)
    setProcessProgress({ current: 0, total: 0, phase: '' })
    if (fileInputRef.current) fileInputRef.current.value = ''

    if (uploadCancelRef.current.cancelled) {
      if (insertedIds.length > 0) {
        try {
          await fetch('/api/admin/photos', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json', ...authHeaders() },
            body: JSON.stringify({ photoIds: insertedIds }),
          })
        } catch {}
      }
      showToast(`Upload cancelled. ${insertedIds.length > 0 ? `${insertedIds.length} partial photo(s) removed.` : ''}`)
      load()
      return
    }

    if (networkError && failedNames.length > 0) {
      showToast('Upload cancelled due to unstable internet. Please check your connection and try again.', 'error')
    } else if (failedNames.length > 0) {
      showToast(`⚠️ ${uploaded} uploaded, ${failedNames.length} failed after retries: ${failedNames.slice(0, 3).join(', ')}${failedNames.length > 3 ? '…' : ''}`, 'error')
    } else {
      showToast(`✅ ${uploaded} photos registered from uploaded files.`)
    }
    load()
  }

  async function executeResetSelection() {
    setConfirmReset(false)
    setResetting(true)
    try {
      const res = await fetch(`/api/admin/customers/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ action: 'unlock' }),
      })
      if (res.ok) { showToast('Unlocked — customer can now update their existing selection'); load() }
      else showToast('Reset failed', 'error')
    } finally { setResetting(false) }
  }

  // ─── Save selected photos for a specific folder ─────────────────────────────
  // Admin picks the local folder → filenames matched against that DB folder's
  // selected photos → saved into a {CustomerName}_selected subfolder.
  async function saveSelectedToFolder(folderId: number, folderName: string) {
    if (!customer) return
    if (!window.showDirectoryPicker) { setFsSupportError(true); return }

    // Fetch all selected photos and filter to this folder only
    const r = await fetch(`/api/admin/download?customerId=${id}`, { headers: authHeaders() })
    if (!r.ok) { showToast('Failed to load selected photos', 'error'); return }
    const { photos: selectedMeta } = await r.json()
    const folderSelected = (selectedMeta ?? []).filter((p: { folderDbId: number }) => p.folderDbId === folderId)
    if (!folderSelected.length) { showToast(`No selected photos in "${folderName}"`, 'error'); return }

    const selectedNames = new Set<string>(folderSelected.map((p: { originalName: string }) => p.originalName))

    // Admin picks the local folder containing the originals for this event folder
    showToast(`📂 Select the local folder for "${folderName}"`)
    let srcHandle: FileSystemDirectoryHandle
    try {
      srcHandle = await window.showDirectoryPicker({ mode: 'readwrite' })
    } catch { return }

    // Pre-scan: collect matching file handles before creating any output folder
    const matchedEntries: { handle: FileSystemFileHandle; name: string }[] = []
    for await (const entry of (srcHandle as any).values()) {
      if (entry.kind !== 'file') continue
      const name: string = (entry as any).name
      if (!selectedNames.has(name)) continue
      matchedEntries.push({ handle: entry as FileSystemFileHandle, name })
    }

    if (matchedEntries.length === 0) {
      setSourceNotFoundError(true)
      return
    }

    // Create / clear the output subfolder inside the picked folder
    const destFolderName = `${customer.name}_selected`
    try { await (srcHandle as any).removeEntry(destFolderName, { recursive: true }) } catch {}
    const destDir = await srcHandle.getDirectoryHandle(destFolderName, { create: true })

    setSaving(true)
    setSaveProgress({ current: 0, total: matchedEntries.length })
    let written = 0

    // Scan and copy matched files
    for await (const entry of (srcHandle as any).values()) {
      if (entry.kind !== 'file') continue
      const name: string = (entry as any).name
      if (!selectedNames.has(name)) continue

      try {
        const file: File = await (entry as FileSystemFileHandle).getFile()
        const buf = await file.arrayBuffer()
        const safeName = name.replace(/[/\\?%*:|"<>]/g, '_')
        const destHandle = await destDir.getFileHandle(safeName, { create: true })
        const writable = await destHandle.createWritable()
        await writable.write(buf)
        await writable.close()
        written++
      } catch {
        showToast(`⚠ Failed to copy: ${name}`, 'error')
      }

      setSaveProgress({ current: written, total: matchedEntries.length })
    }

    const notFound = selectedNames.size - written
    if (notFound > 0) showToast(`⚠ ${notFound} photo(s) not found in source`, 'error')

    // Mark saved in DB
    await fetch('/api/admin/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ customerId: id }),
    })

    showToast(`✅ ${written} of ${selectedNames.size} photos saved to "${destFolderName}" in ${srcHandle.name}`)
    setSaving(false)
    setSaveProgress({ current: 0, total: 0 })
    load()
  }

  function resetSelection() {
    setConfirmReset(true) // opens ConfirmModal → user clicks OK → executeResetSelection() fires the API call
  }

  if (loading) return <PhotoLoader fullPage message="Loading client…" />
  if (!customer) return <div style={{ padding: 40, color: '#f87171' }}>Customer not found</div>

  const selectedPhotos = photos.filter(p => p.isSelected)
  const savedPhotos = photos.filter(p => p.savedToFolder)
  const activeFolderPhotos = activeFolder ? photos.filter(p => p.folderDbId === String(activeFolder.id)) : []
  const hasSession = activeFolder ? !!sessionStore[String(activeFolder.id)] : false

  const statusConfig: Record<string, { label: string; color: string; bg: string; border: string; dot: string }> = {
    delivered:  { label: 'Completed',   color: '#4ade80', bg: 'rgba(74,222,128,0.12)',  border: 'rgba(74,222,128,0.25)',  dot: '#4ade80' },
    locked:     { label: 'Submitted',   color: '#60a5fa', bg: 'rgba(96,165,250,0.12)',  border: 'rgba(96,165,250,0.25)',  dot: '#60a5fa' },
    inprogress: { label: 'In Progress', color: '#f0d78c', bg: 'rgba(212,160,23,0.12)',  border: 'rgba(212,160,23,0.25)',  dot: '#d4a017' },
    pending:    { label: 'Pending',     color: '#fbbf24', bg: 'rgba(251,191,36,0.12)',  border: 'rgba(251,191,36,0.25)',  dot: '#fbbf24' },
    new:        { label: 'New',         color: '#94a3b8', bg: 'rgba(148,163,184,0.10)', border: 'rgba(148,163,184,0.2)', dot: '#94a3b8' },
  }
  const currentStatus = savedPhotos.length > 0 ? 'delivered'
    : customer.selectionLocked ? 'locked'
    : selectedPhotos.length > 0 ? 'inprogress'
    : photos.length > 0 ? 'pending'
    : 'new'
  const statusStyle = statusConfig[currentStatus]

  return (
    <div style={{ padding: '36px 44px' }}>
      {alert && <AlertModal type={alert.type} message={alert.msg} onClose={() => setAlert(null)} />}

      {/* Delete Folder Confirmation Modal */}
      {confirmDeleteFolder && (
        <ConfirmModal
          icon="🗑️"
          title="Delete Folder?"
          message={<>This will permanently delete <span style={{ color: '#f5f0e8', fontWeight: 600 }}>{confirmDeleteFolder.name}</span> and all its photo records. This action cannot be undone.</>}
          confirmLabel="Delete"
          danger
          onConfirm={executeDeleteFolder}
          onCancel={() => setConfirmDeleteFolder(null)}
        />
      )}

      {/* Reset Selection Confirmation Modal */}
      {confirmReset && (
        <ConfirmModal
          icon="🔄"
          title="Reset Selection?"
          message="This clears all current selections so the customer can re-select. This action cannot be undone."
          confirmLabel="Reset"
          onConfirm={executeResetSelection}
          onCancel={() => setConfirmReset(false)}
        />
      )}

      {/* Processing overlay */}
      {(processing || saving) && (
        <div style={{ position: 'fixed', bottom: 80, right: 24, background: '#0f0f0f', border: '1px solid rgba(212,160,23,0.3)', borderRadius: 14, padding: '18px 22px', zIndex: 2000, minWidth: 320, boxShadow: '0 8px 32px rgba(0,0,0,0.6)' }}>
          {processing && (
            <>
              <p style={{ color: '#f0d78c', fontWeight: 600, fontSize: 13, marginBottom: 4 }}>
                {cancelInProgress ? '⏳ Cancelling…' : `🖼 ${processProgress.phase}`}
              </p>
              <p style={{ color: '#8a8070', fontSize: 12, marginBottom: 10 }}>
                {processProgress.current} / {processProgress.total} photos — full-res stays on your disk
              </p>
              <div className="progress-bar">
                <div className="progress-fill" style={{ width: `${processProgress.total > 0 ? (processProgress.current / processProgress.total) * 100 : 0}%` }} />
              </div>
              {!cancelInProgress && (
                <button
                  onClick={() => { uploadCancelRef.current.cancelled = true; setCancelInProgress(true) }}
                  style={{ marginTop: 10, width: '100%', padding: '7px 0', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer', background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.3)', color: '#f87171', fontFamily: "'DM Sans', sans-serif" }}>
                  Cancel Upload
                </button>
              )}
            </>
          )}
          {saving && (
            <>
              <p style={{ color: '#f0d78c', fontWeight: 600, fontSize: 13, marginBottom: 4 }}>
                💾 Copying full-res photos…
              </p>
              <p style={{ color: '#8a8070', fontSize: 12, marginBottom: 10 }}>
                {saveProgress.current} / {saveProgress.total} files copied
              </p>
              <div className="progress-bar">
                <div className="progress-fill" style={{ width: `${saveProgress.total > 0 ? (saveProgress.current / saveProgress.total) * 100 : 0}%` }} />
              </div>
            </>
          )}
        </div>
      )}

      {/* FS API error */}
      {fsSupportError && (
        <div className="modal-overlay" onClick={() => setFsSupportError(false)}>
          <div className="glass-card" onClick={e => e.stopPropagation()} style={{ padding: 36, maxWidth: 420, width: '90%', textAlign: 'center' }}>
            <div style={{ fontSize: 44, marginBottom: 14 }}>⚠️</div>
            <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: 20, color: '#f5f0e8', marginBottom: 10 }}>Browser Not Supported</h2>
            <p style={{ color: '#8a8070', fontSize: 14, marginBottom: 16 }}>Folder access requires the <strong style={{ color: '#f0d78c' }}>File System Access API</strong>.</p>
            <p style={{ color: '#555', fontSize: 13, marginBottom: 24 }}>Use <strong style={{ color: '#f0d78c' }}>Google Chrome</strong> or <strong style={{ color: '#f0d78c' }}>Microsoft Edge</strong> v86+ on desktop.</p>
            <button className="btn-gold" onClick={() => setFsSupportError(false)} style={{ padding: '11px 28px', borderRadius: 9, fontSize: 14 }}>Got it</button>
          </div>
        </div>
      )}

      {/* Source photos not found error */}
      {sourceNotFoundError && (
        <div className="modal-overlay" onClick={() => setSourceNotFoundError(false)}>
          <div className="glass-card" onClick={e => e.stopPropagation()} style={{ padding: 36, maxWidth: 420, width: '90%', textAlign: 'center' }}>
            <div style={{ fontSize: 44, marginBottom: 14 }}>📂</div>
            <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: 20, color: '#f5f0e8', marginBottom: 10 }}>Source Photos Not Found</h2>
            <p style={{ color: '#8a8070', fontSize: 14, marginBottom: 24 }}>None of the selected photos were found in the chosen folder. Please select the correct source folder containing the original photos.</p>
            <button className="btn-gold" onClick={() => setSourceNotFoundError(false)} style={{ padding: '11px 28px', borderRadius: 9, fontSize: 14 }}>OK</button>
          </div>
        </div>
      )}

      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <Link href="/admin/customers" style={{ color: '#8a8070', fontSize: 13, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 25 }}>
          ← Back to Clients
        </Link>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
              <h1 style={{ fontFamily: "'Playfair Display', serif", fontSize: 28, color: '#f5f0e8', margin: 0 }}>{customer.name}</h1>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: statusStyle.bg, border: `1px solid ${statusStyle.border}`, borderRadius: 20, padding: '4px 12px' }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: statusStyle.dot, display: 'inline-block' }} />
                <span style={{ fontSize: 12, fontWeight: 600, color: statusStyle.color }}>{statusStyle.label}</span>
              </span>
            </div>
            <p style={{ color: '#8a8070', fontSize: 13 }}>{customer.eventName}{customer.eventDate && ` · ${customer.eventDate}`}</p>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            {customer.selectionLocked && selectedPhotos.length > 0 && (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, background: 'rgba(96,165,250,0.1)', border: '1px solid rgba(96,165,250,0.25)', borderRadius: 20, padding: '7px 14px' }}>
                  <span>🔒</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: '#60a5fa' }}>Selection Submitted</span>
                </div>
                <button onClick={resetSelection} disabled={resetting} className="btn-outline"
                  style={{ padding: '9px 18px', borderRadius: 9, fontSize: 13, color: '#fbbf24', borderColor: 'rgba(251,191,36,0.3)' }}>
                  {resetting ? 'Resetting…' : '🔄 Reset & Allow Re-selection'}
                </button>
                <button
                  className="btn-gold"
                  disabled={saving || !activeFolder}
                  onClick={() => activeFolder && saveSelectedToFolder(activeFolder.id, activeFolder.name)}
                  title={activeFolder ? `Save selected photos from "${activeFolder.name}"` : 'Select a folder first'}
                  style={{ padding: '9px 18px', borderRadius: 9, fontSize: 13, display: 'flex', alignItems: 'center', gap: 7 }}>
                  {saving ? '⏳ Copying…' : `📁 Save to Folder${activeFolder ? ` · ${activeFolder.name}` : ''}`}
                </button>
              </>
            )}
          </div>
        </div>
      </div>


      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 26 }}>
        <div className="stat-card">
          <p style={{ fontSize: 10, color: '#8a8070', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 5 }}>Contact</p>
          <p style={{ fontSize: 13, color: '#f5f0e8', fontWeight: 600 }}>{customer.phone}</p>
          <p style={{ fontSize: 11, color: '#555', marginTop: 2 }}>{customer.email}</p>
        </div>
        <div className="stat-card" style={{ position: 'relative' }}>
          <button
            onClick={() => {
              const msg = `Dear ${customer.name}\nYour event "${customer.eventName}" is ready for photo selection. Your event code is ${customer.accessCode}. You can select your photos using the following options:\nWebsite: ${process.env.NEXT_PUBLIC_APP_URL}/\nRegards,\nPraveen Photography`
              navigator.clipboard.writeText(msg).then(() => showToast('Message copied to clipboard!'))
            }}
            style={{ position: 'absolute', top: 20, right: 8, fontSize: 10, color: '#f0d78c', background: 'rgba(212,160,23,0.12)', border: '1px solid rgba(212,160,23,0.3)', borderRadius: 6, padding: '2px 8px', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}>
            📋 Copy
          </button>
          <p style={{ fontSize: 10, color: '#8a8070', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 5 }}>Access Code</p>
          <p style={{ fontFamily: 'monospace', fontSize: 15, color: '#f0d78c', fontWeight: 700 }}>{customer.accessCode}</p>
          <p style={{ fontSize: 10, color: '#555', marginTop: 3 }}>Share via Message</p>
        </div>
        <div className="stat-card" onClick={() => setPhotoViewModal('all')}
          style={{ cursor: 'pointer', transition: 'border-color 0.2s' }}
          onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.borderColor = 'rgba(212,160,23,0.5)'}
          onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.borderColor = ''}>
          <p style={{ fontSize: 10, color: '#8a8070', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 5 }}>Photos Registered</p>
          <p style={{ fontSize: 30, fontWeight: 700, color: '#d4a017', fontFamily: "'Playfair Display', serif" }}>{customer.photoCount}</p>
          <p style={{ fontSize: 10, color: '#d4a017', marginTop: 3 }}>Click to view all photos →</p>
        </div>
        <div className="stat-card" onClick={() => setPhotoViewModal('selected')}
          style={{ cursor: selectedPhotos.length > 0 ? 'pointer' : 'default', transition: 'border-color 0.2s' }}
          onMouseEnter={e => { if (selectedPhotos.length > 0) (e.currentTarget as HTMLDivElement).style.borderColor = 'rgba(74,222,128,0.5)' }}
          onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.borderColor = ''}>
          <p style={{ fontSize: 10, color: '#8a8070', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 5 }}>Selected</p>
          <p style={{ fontSize: 30, fontWeight: 700, color: '#4ade80', fontFamily: "'Playfair Display', serif" }}>
            {customer.selectedCount}
            {customer.maxSelectCount > 0 && <span style={{ fontSize: 14, color: '#555', fontFamily: "'DM Sans', sans-serif", fontWeight: 400 }}>/{customer.maxSelectCount}</span>}
          </p>
          {savedPhotos.length > 0
            ? <p style={{ fontSize: 10, color: '#60a5fa' }}>✓ {savedPhotos.length} copied to disk</p>
            : selectedPhotos.length > 0
              ? <p style={{ fontSize: 10, color: '#4ade80', marginTop: 3 }}>Click to view selected →</p>
              : <p style={{ fontSize: 10, color: '#555', marginTop: 3 }}>No selections yet</p>
          }
        </div>
      </div>

      {/* Two-column layout */}
      <div style={{ display: 'grid', gridTemplateColumns: '264px 1fr', gap: 22, alignItems: 'start' }}>

        {/* LEFT: Folders */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="glass-card" style={{ padding: 18 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <h2 style={{ fontSize: 14, fontWeight: 600, color: '#f5f0e8' }}>📁 Folders</h2>
              <button className="btn-gold" onClick={() => setShowFolderModal(true)} style={{ padding: '5px 12px', borderRadius: 7, fontSize: 12 }}>+ New</button>
            </div>

            {folders.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '24px 0', color: '#444', fontSize: 12, lineHeight: 1.7 }}>
                <div style={{ fontSize: 28, marginBottom: 8 }}>📂</div>
                Create a folder, then pick a local folder to register photos from.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {folders.map(folder => {
                  const isActive = activeFolder?.id === folder.id
                  const isLinked = !!sessionStore[String(folder.id)]
                  const label = linkedLabels[String(folder.id)] || folder.localSourcePath
                  return (
                    <div key={folder.id}
                      onClick={() => setActiveFolder(isActive ? null : folder)}
                      style={{
                        padding: '10px 12px', borderRadius: 9, cursor: 'pointer', transition: 'all 0.2s',
                        background: isActive ? 'rgba(212,160,23,0.12)' : 'rgba(255,255,255,0.02)',
                        border: `1px solid ${isActive ? 'rgba(212,160,23,0.35)' : '#1e1e1e'}`,
                      }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{ fontSize: 13, fontWeight: 600, color: isActive ? '#f0d78c' : '#f5f0e8', marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            📁 {folder.name}
                          </p>
                          {label && (
                            <p style={{ fontSize: 10, color: isLinked ? '#4ade80' : '#555', marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {isLinked ? '🔗' : '📂'} {label}
                            </p>
                          )}
                          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                            <span className="badge badge-gold" style={{ fontSize: 10 }}>{folder.photoCount} photos</span>
                            {isLinked && <span className="badge badge-green" style={{ fontSize: 10 }}>Linked ✓</span>}
                          </div>
                        </div>
                        <button onClick={e => { e.stopPropagation(); deleteFolder(folder) }}
                          style={{ background: 'none', border: 'none', color: '#444', cursor: 'pointer', fontSize: 13, padding: '0 0 0 6px', flexShrink: 0 }}>🗑</button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Selected summary */}
          {selectedPhotos.length > 0 && (
            <div className="glass-card" style={{ padding: 16 }}>
              <p style={{ fontSize: 12, color: '#4ade80', fontWeight: 600, marginBottom: 12 }}>✅ {selectedPhotos.length} selected by customer</p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 150, overflowY: 'auto' }}>
                {selectedPhotos.map(p => (
                  <div key={p.id} style={{ fontSize: 11, color: '#8a8070', background: '#111', borderRadius: 5, padding: '4px 8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.originalName}</span>
                    {p.savedToFolder && <span style={{ color: '#60a5fa', fontSize: 9, flexShrink: 0 }}>✓ saved</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* RIGHT */}
        <div>
          {!activeFolder ? (
            <div className="glass-card" style={{ padding: 56, textAlign: 'center' }}>
              <div style={{ fontSize: 52, marginBottom: 16 }}>📂</div>
              <p style={{ color: '#f5f0e8', fontWeight: 600, fontSize: 16, marginBottom: 8 }}>Select a folder to get started</p>
              <p style={{ color: '#555', fontSize: 13, marginBottom: 28 }}>Pick an existing folder from the left panel, or create a new one below.</p>

              {folders.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'center', marginBottom: 28 }}>
                  {folders.map(folder => (
                    <button
                      key={folder.id}
                      onClick={() => setActiveFolder(folder)}
                      style={{
                        padding: '10px 18px', borderRadius: 10, cursor: 'pointer', border: '1px solid rgba(212,160,23,0.3)',
                        background: 'rgba(212,160,23,0.07)', color: '#f0d78c', fontSize: 13, fontWeight: 600,
                        fontFamily: "'DM Sans', sans-serif", display: 'flex', alignItems: 'center', gap: 8, transition: 'all 0.2s',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.background = 'rgba(212,160,23,0.16)'; e.currentTarget.style.borderColor = 'rgba(212,160,23,0.6)' }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'rgba(212,160,23,0.07)'; e.currentTarget.style.borderColor = 'rgba(212,160,23,0.3)' }}
                    >
                      <span>📁</span>
                      <span>{folder.name}</span>
                      <span style={{ fontSize: 11, color: '#8a8070', fontWeight: 400 }}>{folder.photoCount} photos</span>
                    </button>
                  ))}
                </div>
              )}

              <button
                onClick={() => setShowFolderModal(true)}
                className="btn-gold"
                style={{ padding: '11px 26px', borderRadius: 10, fontSize: 14, display: 'inline-flex', alignItems: 'center', gap: 8 }}
              >
                <span>+</span> Create New Folder
              </button>
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                <span style={{ fontSize: 22 }}>📁</span>
                <div style={{ flex: 1 }}>
                  <h2 style={{ fontSize: 18, fontWeight: 600, color: '#f0d78c', marginBottom: 2 }}>{activeFolder.name}</h2>
                  {(linkedLabels[String(activeFolder.id)] || activeFolder.localSourcePath) && (
                    <p style={{ fontSize: 11, color: hasSession ? '#4ade80' : '#8a8070', display: 'flex', alignItems: 'center', gap: 5 }}>
                      {hasSession ? '🔗 Linked:' : '📂 Last used:'}
                      <span style={{ fontFamily: 'monospace' }}>{linkedLabels[String(activeFolder.id)] || activeFolder.localSourcePath}</span>
                    </p>
                  )}
                </div>
              </div>

              {/* Upload zone */}
              <div className="glass-card" style={{ padding: 22, marginBottom: 20 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                  <div>
                    <p style={{ fontSize: 14, fontWeight: 600, color: '#f5f0e8', marginBottom: 3 }}>Register Photos</p>
                    <p style={{ fontSize: 11, color: '#555' }}>Thumbnails stored in DB · Full-res stays on your disk</p>
                  </div>
                  {hasSession && <span style={{ fontSize: 11, color: '#4ade80', background: 'rgba(74,222,128,0.1)', border: '1px solid rgba(74,222,128,0.2)', borderRadius: 20, padding: '3px 10px' }}>🔗 Folder linked</span>}
                </div>

                {/* Mode toggle */}
                <div style={{ display: 'flex', gap: 8, marginBottom: 16, background: 'rgba(255,255,255,0.03)', borderRadius: 10, padding: 4 }}>
                  <button onClick={() => setUploadMode('folder')} style={{ flex: 1, padding: '8px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: 'none', transition: 'all 0.2s', fontFamily: "'DM Sans', sans-serif", background: uploadMode === 'folder' ? 'rgba(212,160,23,0.18)' : 'transparent', color: uploadMode === 'folder' ? '#f0d78c' : '#555' }}>
                    📂 Pick Folder
                  </button>
                  <button onClick={() => setUploadMode('files')} style={{ flex: 1, padding: '8px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: 'none', transition: 'all 0.2s', fontFamily: "'DM Sans', sans-serif", background: uploadMode === 'files' ? 'rgba(212,160,23,0.18)' : 'transparent', color: uploadMode === 'files' ? '#f0d78c' : '#555' }}>
                    🖼 Upload Photos
                  </button>
                </div>

                {processing ? (
                  <div style={{ textAlign: 'center', padding: '20px 0' }}>
                    <PhotoLoader message={`${processProgress.phase} (${processProgress.current}/${processProgress.total})`} />
                    <div className="progress-bar" style={{ maxWidth: 340, margin: '0 auto' }}>
                      <div className="progress-fill" style={{ width: `${processProgress.total > 0 ? (processProgress.current / processProgress.total) * 100 : 0}%` }} />
                    </div>
                    <p style={{ color: '#555', fontSize: 11, marginTop: 10 }}>Generating previews in browser — full-res photos never leave your computer</p>
                  </div>
                ) : totalPhotos >= UPLOAD_LIMIT ? (
                  <div style={{ borderRadius: 12, background: 'rgba(251,191,36,0.06)', border: '2px dashed rgba(251,191,36,0.35)', padding: '28px 20px', textAlign: 'center' }}>
                    <div style={{ fontSize: 36, marginBottom: 10 }}>🚫</div>
                    <p style={{ color: '#fbbf24', fontWeight: 700, fontSize: 15, fontFamily: "'DM Sans', sans-serif", marginBottom: 6 }}>Storage Limit Reached</p>
                    <p style={{ color: '#8a8070', fontSize: 12 }}>
                      The system has reached its limit of <strong style={{ color: '#fbbf24' }}>{UPLOAD_LIMIT.toLocaleString()}</strong> photos.
                      Please contact support or delete unused photos before uploading more.
                    </p>
                  </div>
                ) : uploadMode === 'folder' ? (
                  <button onClick={pickFolderAndProcess}
                    style={{
                      width: '100%', padding: '28px 20px', borderRadius: 12, cursor: 'pointer',
                      background: 'rgba(212,160,23,0.05)', border: '2px dashed rgba(212,160,23,0.3)',
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, transition: 'all 0.25s',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'rgba(212,160,23,0.1)'; e.currentTarget.style.borderColor = 'rgba(212,160,23,0.6)' }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'rgba(212,160,23,0.05)'; e.currentTarget.style.borderColor = 'rgba(212,160,23,0.3)' }}>
                    <span style={{ fontSize: 36 }}>📂</span>
                    <div style={{ textAlign: 'center' }}>
                      <p style={{ color: '#f0d78c', fontWeight: 700, fontSize: 15, fontFamily: "'DM Sans', sans-serif", marginBottom: 4 }}>
                        {hasSession ? 'Pick Another Folder' : 'Pick Folder & Register Photos'}
                      </p>
                      <p style={{ color: '#8a8070', fontSize: 12 }}>Select the event folder from your computer. Previews generated in browser — originals never upload.</p>
                    </div>
                  </button>
                ) : (
                  <>
                    <input ref={fileInputRef} type="file" multiple accept="image/*" style={{ display: 'none' }} onChange={e => uploadFilesAndProcess(e.target.files)} />
                    <button onClick={() => fileInputRef.current?.click()}
                      style={{ width: '100%', padding: '28px 20px', borderRadius: 12, cursor: 'pointer', background: 'rgba(96,165,250,0.04)', border: '2px dashed rgba(96,165,250,0.3)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, transition: 'all 0.25s' }}
                      onMouseEnter={e => { e.currentTarget.style.background = 'rgba(96,165,250,0.09)'; e.currentTarget.style.borderColor = 'rgba(96,165,250,0.6)' }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'rgba(96,165,250,0.04)'; e.currentTarget.style.borderColor = 'rgba(96,165,250,0.3)' }}>
                      <span style={{ fontSize: 36 }}>🖼️</span>
                      <div style={{ textAlign: 'center' }}>
                        <p style={{ color: '#93c5fd', fontWeight: 700, fontSize: 15, fontFamily: "'DM Sans', sans-serif", marginBottom: 4 }}>Select Photos to Upload</p>
                        <p style={{ color: '#8a8070', fontSize: 12 }}>Pick individual image files.</p>
                      </div>
                    </button>
                  </>
                )}
              </div>

              {/* Photo grid */}
              {activeFolderPhotos.length > 0 && (
                <div className="glass-card" style={{ padding: 18 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <p style={{ fontSize: 14, fontWeight: 600, color: '#f5f0e8' }}>Photos in this folder</p>
                    <div style={{ display: 'flex', gap: 7 }}>
                      <span className="badge badge-gold">{activeFolderPhotos.length}</span>
                      <span className="badge badge-green">{activeFolderPhotos.filter(p => p.isSelected).length} selected</span>
                      {activeFolderPhotos.filter(p => p.savedToFolder).length > 0 && (
                        <span className="badge badge-blue">{activeFolderPhotos.filter(p => p.savedToFolder).length} saved</span>
                      )}
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: 7 }}>
                    {activeFolderPhotos.map(photo => (
                      <div key={photo.id} style={{ position: 'relative', borderRadius: 8, overflow: 'hidden', aspectRatio: '1', background: '#111' }}
                        title={photo.originalName}>
                        <img
                          src={photo.thumbnailUrl}
                          alt={photo.originalName}
                          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                        />
                        {photo.isSelected && (
                          <div style={{ position: 'absolute', top: 4, right: 4, background: '#4ade80', borderRadius: '50%', width: 16, height: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, color: '#0a0a0a', fontWeight: 700 }}>✓</div>
                        )}
                        {photo.savedToFolder && (
                          <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'rgba(96,165,250,0.75)', padding: '2px 0', fontSize: 9, color: '#fff', textAlign: 'center', fontWeight: 700 }}>SAVED</div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Floating counter */}
      <div className="floating-counter">
        🖼 {customer.photoCount} · ✅ {customer.selectedCount}{customer.maxSelectCount > 0 ? `/${customer.maxSelectCount}` : ''}
      </div>

      {/* Photo Viewer Modal */}
      {photoViewModal && (
        <div className="modal-overlay" onClick={() => setPhotoViewModal(null)}>
          <div className="glass-card" onClick={e => e.stopPropagation()}
            style={{ padding: 28, width: '95%', maxWidth: 1000, maxHeight: '88vh', display: 'flex', flexDirection: 'column' }}>

            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexShrink: 0 }}>
              <div>
                <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: 20, color: '#f5f0e8', marginBottom: 4 }}>
                  {photoViewModal === 'all' ? '🖼 All Uploaded Photos' : '✅ Customer Selected Photos'}
                </h2>
                <p style={{ fontSize: 12, color: '#8a8070' }}>
                  {photoViewModal === 'all'
                    ? `${photos.length} photo${photos.length !== 1 ? 's' : ''} registered across ${folders.length} folder${folders.length !== 1 ? 's' : ''}`
                    : `${selectedPhotos.length} photo${selectedPhotos.length !== 1 ? 's' : ''} selected by customer`}
                </p>
              </div>
              <button onClick={() => setPhotoViewModal(null)}
                style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: 22, lineHeight: 1 }}>✕</button>
            </div>

            {/* Photo grid */}
            <div style={{ overflowY: 'auto', flex: 1 }}>
              {(() => {
                const viewPhotos = photoViewModal === 'all' ? photos : selectedPhotos
                if (viewPhotos.length === 0) return (
                  <div style={{ textAlign: 'center', padding: '60px 20px', color: '#555' }}>
                    <div style={{ fontSize: 44, marginBottom: 12 }}>📸</div>
                    <p>{photoViewModal === 'all' ? 'No photos uploaded yet' : 'No photos selected yet'}</p>
                  </div>
                )

                // Group by folder
                const byFolder: Record<string, Photo[]> = {}
                viewPhotos.forEach(photo => {
                  const key = photo.folderName || 'Uncategorised'
                  if (!byFolder[key]) byFolder[key] = []
                  byFolder[key].push(photo)
                })

                return Object.entries(byFolder).map(([folderName, folderPhotos]) => (
                  <div key={folderName} style={{ marginBottom: 24 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                      <span style={{ fontSize: 13 }}>📁</span>
                      <span style={{ fontSize: 13, fontWeight: 600, color: '#f0d78c' }}>{folderName}</span>
                      <span style={{ fontSize: 11, color: '#555', background: 'rgba(212,160,23,0.1)', borderRadius: 10, padding: '2px 8px' }}>
                        {folderPhotos.length} photos
                      </span>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: 6 }}>
                      {folderPhotos.map((photo) => {
                        const flatList = Object.values(
                          (() => {
                            const viewPhotos = photoViewModal === 'all' ? photos : selectedPhotos
                            const byFolder2: Record<string, Photo[]> = {}
                            viewPhotos.forEach(p => { const k = p.folderName || 'Uncategorised'; if (!byFolder2[k]) byFolder2[k] = []; byFolder2[k].push(p) })
                            return byFolder2
                          })()
                        ).flat()
                        const globalIndex = flatList.findIndex(p => p.id === photo.id)
                        return (
                          <div key={photo.id}
                            onClick={() => { setModalLightbox({ list: flatList, index: globalIndex }); setAdminRotation(0) }}
                            style={{ position: 'relative', borderRadius: 8, overflow: 'hidden', aspectRatio: '1', background: '#111', cursor: 'zoom-in' }}
                            title={photo.originalName}>
                            <img
                              src={photo.thumbnailUrl}
                              alt={photo.originalName}
                              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', transition: 'transform 0.2s' }}
                              loading="lazy"
                              onMouseEnter={e => (e.currentTarget.style.transform = 'scale(1.05)')}
                              onMouseLeave={e => (e.currentTarget.style.transform = 'scale(1)')}
                            />
                            {photo.isSelected && (
                              <div style={{ position: 'absolute', top: 5, right: 5, width: 18, height: 18, borderRadius: '50%', background: '#4ade80', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: '#0a0a0a', fontWeight: 800 }}>✓</div>
                            )}
                            {photo.savedToFolder && (
                              <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'rgba(96,165,250,0.8)', padding: '2px 0', fontSize: 9, color: '#fff', textAlign: 'center', fontWeight: 700 }}>SAVED</div>
                            )}
                            <div style={{ position: 'absolute', bottom: photo.savedToFolder ? 16 : 4, left: 0, right: 0, padding: '0 4px' }}>
                              <p style={{ fontSize: 8, color: 'rgba(255,255,255,0.6)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textShadow: '0 1px 3px rgba(0,0,0,0.9)' }}>
                                {photo.originalName}
                              </p>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ))
              })()}
            </div>
          </div>
        </div>
      )}

      {/* Photo Lightbox (inside photo viewer modal) */}
      {modalLightbox && (() => {
        const { list, index } = modalLightbox
        const photo = list[index]
        const goPrev = () => { setModalLightbox({ list, index: (index - 1 + list.length) % list.length }); setAdminRotation(0) }
        const goNext = () => { setModalLightbox({ list, index: (index + 1) % list.length }); setAdminRotation(0) }
        return (
          <div
            onClick={() => setModalLightbox(null)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.92)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            onKeyDown={e => { if (e.key === 'Escape') setModalLightbox(null); if (e.key === 'ArrowLeft') goPrev(); if (e.key === 'ArrowRight') goNext() }}
          >
            {/* Close */}
            <button onClick={() => { setModalLightbox(null); setAdminRotation(0) }}
              style={{ position: 'absolute', top: 20, right: 24, background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', color: '#fff', borderRadius: '50%', width: 40, height: 40, fontSize: 18, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>

            {/* Rotate */}
            <button onClick={e => { e.stopPropagation(); setAdminRotation(r => (r + 90) % 360) }}
              title="Rotate 90°"
              style={{ position: 'absolute', top: 20, left: 24, background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', color: '#fff', borderRadius: '50%', width: 40, height: 40, fontSize: 18, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>↻</button>

            {/* Prev */}
            {list.length > 1 && (
              <button onClick={e => { e.stopPropagation(); goPrev() }}
                style={{ position: 'absolute', left: 20, background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', color: '#fff', borderRadius: '50%', width: 44, height: 44, fontSize: 20, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>‹</button>
            )}

            {/* Image */}
            <div onClick={e => e.stopPropagation()} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', maxWidth: '85vw', maxHeight: '85vh' }}>
              <img
                src={photo.thumbnailUrl}
                alt={photo.originalName}
                style={{
                  maxWidth: (adminRotation === 90 || adminRotation === 270) ? '72vh' : '100%',
                  maxHeight: (adminRotation === 90 || adminRotation === 270) ? '82vw' : '72vh',
                  objectFit: 'contain', borderRadius: 10,
                  boxShadow: '0 8px 48px rgba(0,0,0,0.8)',
                  transform: `rotate(${adminRotation}deg)`,
                  transition: 'transform 0.25s ease',
                }}
              />
              <div style={{ marginTop: 14, textAlign: 'center' }}>
                <p style={{ color: '#f5f0e8', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>{photo.originalName}</p>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 11, color: '#8a8070' }}>📁 {photo.folderName}</span>
                  {photo.isSelected && <span style={{ fontSize: 11, color: '#4ade80', background: 'rgba(74,222,128,0.1)', borderRadius: 8, padding: '2px 8px' }}>✓ Selected</span>}
                  {photo.savedToFolder && <span style={{ fontSize: 11, color: '#60a5fa', background: 'rgba(96,165,250,0.1)', borderRadius: 8, padding: '2px 8px' }}>💾 Saved</span>}
                  <span style={{ fontSize: 11, color: '#555' }}>{index + 1} / {list.length}</span>
                </div>
              </div>
            </div>

            {/* Next */}
            {list.length > 1 && (
              <button onClick={e => { e.stopPropagation(); goNext() }}
                style={{ position: 'absolute', right: 20, background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', color: '#fff', borderRadius: '50%', width: 44, height: 44, fontSize: 20, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>›</button>
            )}
          </div>
        )
      })()}

      {/* Create Folder Modal */}
      {showFolderModal && (
        <div className="modal-overlay" onClick={() => setShowFolderModal(false)}>
          <div className="glass-card" onClick={e => e.stopPropagation()} style={{ padding: 32, maxWidth: 420, width: '90%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: 20, color: '#f5f0e8' }}>Create New Folder</h2>
              <button onClick={() => setShowFolderModal(false)} style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: 18 }}>✕</button>
            </div>
            <form onSubmit={createFolder}>
              <div style={{ marginBottom: 14 }}>
                <label style={{ display: 'block', fontSize: 11, color: '#8a8070', marginBottom: 6, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                  Folder Name <span style={{ color: '#d4a017' }}>*</span>
                </label>
                <input className="input-dark" value={folderForm.name}
                  onChange={e => setFolderForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Wedding Ceremony, Reception" required
                  style={{ padding: '11px 13px', fontSize: 14 }} autoFocus />
              </div>
              <div style={{ marginBottom: 20 }}>
                <label style={{ display: 'block', fontSize: 11, color: '#8a8070', marginBottom: 6, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Description</label>
                <input className="input-dark" value={folderForm.description}
                  onChange={e => setFolderForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="Optional notes" style={{ padding: '11px 13px', fontSize: 14 }} />
              </div>
              <div style={{ background: 'rgba(212,160,23,0.06)', border: '1px solid rgba(212,160,23,0.15)', borderRadius: 10, padding: '12px 14px', marginBottom: 20 }}>
                <p style={{ fontSize: 12, color: '#8a8070', lineHeight: 1.5 }}>
                  💡 After creating, click <strong style={{ color: '#f0d78c' }}>📂 Pick Folder & Register Photos</strong> to select the event folder from your computer. Previews are generated in the browser — your full-res photos never leave your disk.
                </p>
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button type="button" onClick={() => setShowFolderModal(false)} className="btn-outline" style={{ flex: 1, padding: '11px 0', borderRadius: 9, fontSize: 14 }}>Cancel</button>
                <button type="submit" className="btn-gold" disabled={savingFolder} style={{ flex: 1, padding: '11px 0', borderRadius: 9, fontSize: 14 }}>
                  {savingFolder ? 'Creating…' : '📁 Create Folder'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
