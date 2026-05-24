import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { folders, photos, customers } from '@/lib/schema'
import { eq, desc, count, and } from 'drizzle-orm'
import { verifyToken, getTokenFromRequest } from '@/lib/auth'
import { deleteThumbnailFromR2 } from '@/lib/r2'

function adminAuth(req: NextRequest) {
  const token = getTokenFromRequest(req)
  if (!token) return null
  const decoded = verifyToken(token)
  if (!decoded || decoded.role !== 'admin') return null
  return decoded
}

export async function GET(req: NextRequest) {
  if (!adminAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const customerId = searchParams.get('customerId')
  if (!customerId) return NextResponse.json({ error: 'Missing customerId' }, { status: 400 })

  const rows = await db
    .select()
    .from(folders)
    .where(eq(folders.customerId, parseInt(customerId)))
    .orderBy(desc(folders.createdAt))

  return NextResponse.json(rows)
}

export async function POST(req: NextRequest) {
  if (!adminAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { customerId, name, description, localSourcePath } = await req.json()
  if (!customerId || !name) return NextResponse.json({ error: 'Missing fields' }, { status: 400 })

  const [folder] = await db
    .insert(folders)
    .values({
      customerId: parseInt(customerId),
      name: name.trim(),
      description: description || '',
      localSourcePath: localSourcePath || '',
    })
    .returning()

  return NextResponse.json(folder, { status: 201 })
}

export async function PATCH(req: NextRequest) {
  if (!adminAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { folderId, localSourcePath } = await req.json()
  if (!folderId) return NextResponse.json({ error: 'Missing folderId' }, { status: 400 })

  const [folder] = await db
    .update(folders)
    .set({ localSourcePath })
    .where(eq(folders.id, parseInt(folderId)))
    .returning()

  return NextResponse.json(folder)
}

export async function DELETE(req: NextRequest) {
  if (!adminAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const folderId = searchParams.get('folderId')
  if (!folderId) return NextResponse.json({ error: 'Missing folderId' }, { status: 400 })

  const fId = parseInt(folderId)

  // Get folder to know which customer to update
  const [folder] = await db.select({ customerId: folders.customerId }).from(folders).where(eq(folders.id, fId))
  if (!folder) return NextResponse.json({ error: 'Folder not found' }, { status: 404 })

  const photoRows = await db
    .select({ r2ObjectKey: photos.r2ObjectKey })
    .from(photos)
    .where(eq(photos.folderDbId, fId))

  const keys = photoRows.map(r => r.r2ObjectKey).filter(Boolean) as string[]
  let idx = 0
  async function worker() {
    while (idx < keys.length) await deleteThumbnailFromR2(keys[idx++])
  }
  await Promise.all(Array.from({ length: Math.min(25, keys.length) }, worker))

  await db.delete(photos).where(eq(photos.folderDbId, fId))
  await db.delete(folders).where(eq(folders.id, fId))

  // Recalculate and sync customer photo + selected counts
  const [photoCountRow] = await db.select({ value: count() }).from(photos).where(eq(photos.customerId, folder.customerId))
  const [selectedCountRow] = await db.select({ value: count() }).from(photos).where(and(eq(photos.customerId, folder.customerId), eq(photos.isSelected, true)))

  // If no photos remain, clear the selection lock so status reverts from "Submitted"
  const updateFields: Record<string, unknown> = { photoCount: photoCountRow.value, selectedCount: selectedCountRow.value }
  if (photoCountRow.value === 0) { updateFields.selectionLocked = false; updateFields.selectionLockedAt = null }

  await db.update(customers)
    .set(updateFields)
    .where(eq(customers.id, folder.customerId))

  return NextResponse.json({ success: true })
}
