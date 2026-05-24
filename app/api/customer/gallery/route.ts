import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { customers, folders, photos } from '@/lib/schema'
import { eq } from 'drizzle-orm'
import { verifyToken, getTokenFromRequest } from '@/lib/auth'

function customerAuth(req: NextRequest) {
  const token = getTokenFromRequest(req)
  if (!token) return null
  const decoded = verifyToken(token)
  if (!decoded || decoded.role !== 'customer') return null
  return decoded
}

export async function GET(req: NextRequest) {
  const auth = customerAuth(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const cId = parseInt(auth.id)

  const [customer] = await db.select().from(customers).where(eq(customers.id, cId))
  if (!customer) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const customerFolders = await db
    .select()
    .from(folders)
    .where(eq(folders.customerId, cId))
    .orderBy(folders.createdAt)

  const customerPhotos = await db
    .select({
      id: photos.id,
      originalName: photos.originalName,
      mimeType: photos.mimeType,
      size: photos.size,
      thumbnailUrl: photos.thumbnailUrl,
      isSelected: photos.isSelected,
      folderDbId: photos.folderDbId,
      folderName: photos.folderName,
      uploadedAt: photos.uploadedAt,
    })
    .from(photos)
    .where(eq(photos.customerId, cId))
    .orderBy(photos.uploadedAt)

  return NextResponse.json({
    customer: {
      id:               customer.id,
      name:             customer.name,
      eventName:        customer.eventName,
      photoCount:       customer.photoCount,
      selectedCount:    customer.selectedCount,
      maxSelectCount:   customer.maxSelectCount,
      selectionLocked:  customer.selectionLocked,
      selectionLockedAt: customer.selectionLockedAt,
    },
    folders: customerFolders,
    photos: customerPhotos,
  })
}
