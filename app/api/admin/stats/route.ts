import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { customers, photos } from '@/lib/schema'
import { eq, count, isNotNull } from 'drizzle-orm'
import { verifyToken, getTokenFromRequest } from '@/lib/auth'

function adminAuth(req: NextRequest) {
  const token = getTokenFromRequest(req)
  if (!token) return null
  const decoded = verifyToken(token)
  if (!decoded || decoded.role !== 'admin') return null
  return decoded
}

export async function GET(req: NextRequest) {
  if (!adminAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [[{ totalCustomers }], [{ totalPhotos }], [{ totalSelected }]] = await Promise.all([
    db.select({ totalCustomers: count() }).from(customers),
    db.select({ totalPhotos: count() }).from(photos),
    db.select({ totalSelected: count() }).from(photos).where(eq(photos.isSelected, true)),
  ])

  return NextResponse.json({ totalCustomers, totalPhotos, totalSelected, totalDownloaded: 0 })
}
