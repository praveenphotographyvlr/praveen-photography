import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { customers, photos, folders } from '@/lib/schema'
import { lte, eq, sql } from 'drizzle-orm'
import { verifyToken, getTokenFromRequest } from '@/lib/auth'
import { deleteThumbnailFromR2 } from '@/lib/r2'

function isCronRequest(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  return !!(secret && req.headers.get('authorization') === `Bearer ${secret}`)
}

export async function POST(req: NextRequest) {
  const token = getTokenFromRequest(req)
  const decoded = token ? verifyToken(token) : null
  if (!decoded?.role?.includes('admin') && !isCronRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const expired = await db
    .select({ id: customers.id, name: customers.name })
    .from(customers)
    .where(lte(customers.createdAt, sql`NOW() - INTERVAL '45 days'`))

  let deleted = 0

  for (const customer of expired) {
    const photoRows = await db
      .select({ r2ObjectKey: photos.r2ObjectKey })
      .from(photos)
      .where(eq(photos.customerId, customer.id))

    const keys = photoRows.map(r => r.r2ObjectKey).filter(Boolean) as string[]
    let idx = 0
    async function worker() {
      while (idx < keys.length) await deleteThumbnailFromR2(keys[idx++])
    }
    await Promise.all(Array.from({ length: Math.min(25, keys.length) }, worker))

    await db.delete(photos).where(eq(photos.customerId, customer.id))
    await db.delete(folders).where(eq(folders.customerId, customer.id))
    await db.delete(customers).where(eq(customers.id, customer.id))
    deleted++
    console.log(`Auto-deleted client ${customer.name} (id=${customer.id}) after 45 days`)
  }

  return NextResponse.json({ success: true, deleted })
}
