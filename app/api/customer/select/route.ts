import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { customers, photos } from '@/lib/schema'
import { eq, and, count, inArray } from 'drizzle-orm'
import { verifyToken, getTokenFromRequest } from '@/lib/auth'

function customerAuth(req: NextRequest) {
  const token = getTokenFromRequest(req)
  if (!token) return null
  const decoded = verifyToken(token)
  if (!decoded || decoded.role !== 'customer') return null
  return decoded
}

// Single toggle
export async function POST(req: NextRequest) {
  const auth = customerAuth(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const cId = parseInt(auth.id)
  const [customer] = await db.select().from(customers).where(eq(customers.id, cId))
  if (customer?.selectionLocked) {
    return NextResponse.json({ error: 'Selection is locked. Contact your photographer.' }, { status: 403 })
  }

  const { photoId, selected } = await req.json()

  const [photo] = await db
    .select()
    .from(photos)
    .where(and(eq(photos.id, parseInt(photoId)), eq(photos.customerId, cId)))
  if (!photo) return NextResponse.json({ error: 'Photo not found' }, { status: 404 })

  await db
    .update(photos)
    .set({ isSelected: selected, selectedAt: selected ? new Date() : null })
    .where(eq(photos.id, photo.id))

  const [{ selectedCount }] = await db
    .select({ selectedCount: count() })
    .from(photos)
    .where(and(eq(photos.customerId, cId), eq(photos.isSelected, true)))

  await db.update(customers).set({ selectedCount }).where(eq(customers.id, cId))

  return NextResponse.json({ success: true, isSelected: selected, selectedCount })
}

// Bulk draft save — persists selection without locking (used by debounce + sendBeacon)
export async function PATCH(req: NextRequest) {
  const auth = customerAuth(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const cId = parseInt(auth.id)
  const [customer] = await db.select().from(customers).where(eq(customers.id, cId))
  if (customer?.selectionLocked) {
    return NextResponse.json({ error: 'Selection is locked.' }, { status: 403 })
  }

  const { photoIds } = await req.json()

  await db.update(photos).set({ isSelected: false, selectedAt: null }).where(eq(photos.customerId, cId))

  if (photoIds?.length) {
    const max = customer?.maxSelectCount || 0
    const ids = (max > 0 ? photoIds.slice(0, max) : photoIds).map(Number)
    await db
      .update(photos)
      .set({ isSelected: true, selectedAt: new Date() })
      .where(and(inArray(photos.id, ids), eq(photos.customerId, cId)))
  }

  const [{ selectedCount }] = await db
    .select({ selectedCount: count() })
    .from(photos)
    .where(and(eq(photos.customerId, cId), eq(photos.isSelected, true)))

  await db.update(customers).set({ selectedCount }).where(eq(customers.id, cId))

  return NextResponse.json({ success: true, selectedCount })
}

// Final confirm — saves all selections and locks
export async function PUT(req: NextRequest) {
  const auth = customerAuth(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const cId = parseInt(auth.id)
  const [customer] = await db.select().from(customers).where(eq(customers.id, cId))
  if (customer?.selectionLocked) {
    return NextResponse.json({ error: 'Selection already locked' }, { status: 403 })
  }

  const { photoIds } = await req.json()

  await db
    .update(photos)
    .set({ isSelected: false, selectedAt: null })
    .where(eq(photos.customerId, cId))

  if (photoIds?.length) {
    await db
      .update(photos)
      .set({ isSelected: true, selectedAt: new Date() })
      .where(and(inArray(photos.id, photoIds.map(Number)), eq(photos.customerId, cId)))
  }

  const [{ selectedCount }] = await db
    .select({ selectedCount: count() })
    .from(photos)
    .where(and(eq(photos.customerId, cId), eq(photos.isSelected, true)))

  await db
    .update(customers)
    .set({ selectedCount, selectionLocked: true, selectionLockedAt: new Date() })
    .where(eq(customers.id, cId))

  return NextResponse.json({ success: true, selectedCount, locked: true })
}
