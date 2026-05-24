import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { photos, folders, customers } from '@/lib/schema'
import { eq, and, count, inArray } from 'drizzle-orm'
import { verifyToken, getTokenFromRequest } from '@/lib/auth'
import { uploadThumbnailToR2, deleteThumbnailFromR2 } from '@/lib/r2'

function adminAuth(req: NextRequest) {
  const token = getTokenFromRequest(req)
  if (!token) return null
  const decoded = verifyToken(token)
  if (!decoded || decoded.role !== 'admin') return null
  return decoded
}

export async function POST(req: NextRequest) {
  if (!adminAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { customerId, folderDbId, photos: photoList } = body

  if (!customerId || !folderDbId || !Array.isArray(photoList) || !photoList.length) {
    return NextResponse.json({ error: 'Missing data' }, { status: 400 })
  }

  const cId = parseInt(customerId)
  const fId = parseInt(folderDbId)

  const [customer] = await db.select().from(customers).where(eq(customers.id, cId))
  if (!customer) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })

  const [folder] = await db.select().from(folders).where(eq(folders.id, fId))
  if (!folder) return NextResponse.json({ error: 'Folder not found' }, { status: 404 })

  const inserted: number[] = []
  const errors: string[] = []

  // Upload all photos in the batch to R2 concurrently
  const CONCURRENCY = 15
  const MAX_UPLOAD_RETRIES = 5
  const valid = photoList.filter(p => p.originalName && p.thumbnailData)

  async function uploadOne(p: typeof valid[number]) {
    let lastErr: unknown
    for (let attempt = 0; attempt <= MAX_UPLOAD_RETRIES; attempt++) {
      if (attempt > 0) await new Promise(r => setTimeout(r, 500 * Math.pow(2, attempt - 1)))
      try {
        const { public_url, object_key } = await uploadThumbnailToR2(
          p.thumbnailData,
          p.mimeType || 'image/jpeg',
          `praveen-photography/${customerId}`
        )
        const [doc] = await db
          .insert(photos)
          .values({
            customerId: cId,
            folderDbId: fId,
            folderName: folder.name,
            originalName: p.originalName,
            mimeType: p.mimeType || 'image/jpeg',
            size: p.size || 0,
            thumbnailUrl: public_url,
            r2ObjectKey: object_key,
          })
          .returning({ id: photos.id })
        inserted.push(doc.id)
        return
      } catch (err) {
        lastErr = err
      }
    }
    console.error(`Failed to upload ${p.originalName} after ${MAX_UPLOAD_RETRIES + 1} attempts:`, lastErr)
    errors.push(p.originalName)
  }

  // Process with bounded concurrency
  let idx = 0
  async function worker() {
    while (idx < valid.length) {
      const p = valid[idx++]
      await uploadOne(p)
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, valid.length) }, worker))

  // Update folder photo count
  const [folderCountRow] = await db
    .select({ value: count() })
    .from(photos)
    .where(eq(photos.folderDbId, fId))
  await db.update(folders).set({ photoCount: folderCountRow.value }).where(eq(folders.id, fId))

  // Update customer photo count
  const [totalRow] = await db
    .select({ value: count() })
    .from(photos)
    .where(eq(photos.customerId, cId))
  await db.update(customers).set({ photoCount: totalRow.value }).where(eq(customers.id, cId))

  return NextResponse.json({
    success: true,
    uploaded: inserted.length,
    failed: errors.length,
    failedFiles: errors,
    insertedIds: inserted,
    total: totalRow.value,
  })
}

export async function GET(req: NextRequest) {
  if (!adminAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const customerId = searchParams.get('customerId')
  const folderDbId = searchParams.get('folderDbId')

  let query = db
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
    .$dynamic()

  const conditions = []
  if (customerId) conditions.push(eq(photos.customerId, parseInt(customerId)))
  if (folderDbId) conditions.push(eq(photos.folderDbId, parseInt(folderDbId)))
  if (conditions.length) query = query.where(and(...conditions))

  const rows = await query.orderBy(photos.uploadedAt)
  return NextResponse.json(rows)
}

export async function DELETE(req: NextRequest) {
  if (!adminAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { photoIds } = body
  if (!Array.isArray(photoIds) || !photoIds.length) {
    return NextResponse.json({ error: 'Missing photoIds' }, { status: 400 })
  }

  const photoRecords = await db.select().from(photos).where(inArray(photos.id, photoIds))
  if (!photoRecords.length) return NextResponse.json({ success: true, deleted: 0 })

  await Promise.all(photoRecords.map(p => p.r2ObjectKey ? deleteThumbnailFromR2(p.r2ObjectKey) : Promise.resolve()))
  await db.delete(photos).where(inArray(photos.id, photoIds))

  const customerIds = [...new Set(photoRecords.map(p => p.customerId))]
  const folderIds = [...new Set(photoRecords.map(p => p.folderDbId))]

  await Promise.all([
    ...customerIds.map(async cId => {
      const [row] = await db.select({ value: count() }).from(photos).where(eq(photos.customerId, cId))
      await db.update(customers).set({ photoCount: row.value }).where(eq(customers.id, cId))
    }),
    ...folderIds.map(async fId => {
      const [row] = await db.select({ value: count() }).from(photos).where(eq(photos.folderDbId, fId))
      await db.update(folders).set({ photoCount: row.value }).where(eq(folders.id, fId))
    }),
  ])

  return NextResponse.json({ success: true, deleted: photoRecords.length })
}
