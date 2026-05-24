import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { customers, photos, folders } from '@/lib/schema'
import { eq } from 'drizzle-orm'
import { verifyToken, getTokenFromRequest } from '@/lib/auth'
import { deleteThumbnailFromR2 } from '@/lib/r2'

function adminAuth(req: NextRequest) {
  const token = getTokenFromRequest(req)
  if (!token) return null
  const decoded = verifyToken(token)
  if (!decoded || decoded.role !== 'admin') return null
  return decoded
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!adminAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const customerId = parseInt(id)
  const [customer] = await db.select().from(customers).where(eq(customers.id, customerId))
  if (!customer) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const customerPhotos = await db
    .select({
      id: photos.id,
      customerId: photos.customerId,
      folderDbId: photos.folderDbId,
      folderName: photos.folderName,
      originalName: photos.originalName,
      mimeType: photos.mimeType,
      size: photos.size,
      thumbnailUrl: photos.thumbnailUrl,
      isSelected: photos.isSelected,
      selectedAt: photos.selectedAt,
      savedToFolder: photos.savedToFolder,
      savedAt: photos.savedAt,
      uploadedAt: photos.uploadedAt,
    })
    .from(photos)
    .where(eq(photos.customerId, customerId))
    .orderBy(photos.uploadedAt)

  return NextResponse.json({ customer, photos: customerPhotos })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!adminAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const customerId = parseInt(id)

  // Fetch all R2 keys before deleting from DB
  const photoRows = await db
    .select({ r2ObjectKey: photos.r2ObjectKey })
    .from(photos)
    .where(eq(photos.customerId, customerId))

  const keys = photoRows.map(r => r.r2ObjectKey).filter(Boolean) as string[]

  // Delete from R2 with bounded concurrency
  const CONCURRENCY = 25
  let idx = 0
  async function worker() {
    while (idx < keys.length) {
      const key = keys[idx++]
      await deleteThumbnailFromR2(key)
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, keys.length) }, worker))

  await db.delete(photos).where(eq(photos.customerId, customerId))
  await db.delete(folders).where(eq(folders.customerId, customerId))
  await db.delete(customers).where(eq(customers.id, customerId))
  return NextResponse.json({ success: true })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!adminAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const customerId = parseInt(id)
  const body = await req.json()
  const { action } = body

  if (action === 'update') {
    const { name, email, phone, eventName, eventDate, maxSelectCount } = body
    await db
      .update(customers)
      .set({ name, email, phone, eventName, eventDate, maxSelectCount: Number(maxSelectCount) || 0 })
      .where(eq(customers.id, customerId))
    return NextResponse.json({ success: true })
  }

  if (action === 'unlock') {
    // Remove the lock and clear savedToFolder so the status returns to
    // "In Progress" instead of staying "Completed". Selections are preserved
    // so the customer can continue from where they left off.
    await db
      .update(customers)
      .set({ selectionLocked: false, selectionLockedAt: null })
      .where(eq(customers.id, customerId))

    await db
      .update(photos)
      .set({ savedToFolder: false, savedAt: null })
      .where(eq(photos.customerId, customerId))

    return NextResponse.json({ success: true, message: 'Unlocked — customer can now update their selection' })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
