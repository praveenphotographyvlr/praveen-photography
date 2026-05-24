import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { photos, customers } from '@/lib/schema'
import { eq, count } from 'drizzle-orm'
import { verifyToken, getTokenFromRequest } from '@/lib/auth'
import { deleteThumbnailFromR2 } from '@/lib/r2'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const token = getTokenFromRequest(req)
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const decoded = verifyToken(token)
  if (!decoded) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const [photo] = await db
    .select({
      id: photos.id,
      customerId: photos.customerId,
      originalName: photos.originalName,
      mimeType: photos.mimeType,
      thumbnailUrl: photos.thumbnailUrl,
    })
    .from(photos)
    .where(eq(photos.id, parseInt(id)))

  if (!photo) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (decoded.role === 'customer' && String(photo.customerId) !== decoded.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  return NextResponse.json(photo)
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const token = getTokenFromRequest(req)
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const decoded = verifyToken(token)
  if (!decoded || decoded.role !== 'admin') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const photoId = parseInt(id)
  const [photo] = await db.select().from(photos).where(eq(photos.id, photoId))
  if (!photo) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (photo.r2ObjectKey) {
    await deleteThumbnailFromR2(photo.r2ObjectKey)
  }

  await db.delete(photos).where(eq(photos.id, photoId))

  const [totalRow] = await db
    .select({ value: count() })
    .from(photos)
    .where(eq(photos.customerId, photo.customerId))

  await db.update(customers).set({ photoCount: totalRow.value }).where(eq(customers.id, photo.customerId))

  return NextResponse.json({ success: true })
}
