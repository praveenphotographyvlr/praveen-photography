import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { photos } from '@/lib/schema'
import { eq, and } from 'drizzle-orm'
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

  const { searchParams } = new URL(req.url)
  const photoId = searchParams.get('id')

  const [photo] = await db
    .select({
      id: photos.id,
      originalName: photos.originalName,
      mimeType: photos.mimeType,
      thumbnailUrl: photos.thumbnailUrl,
    })
    .from(photos)
    .where(and(eq(photos.id, parseInt(photoId!)), eq(photos.customerId, parseInt(auth.id))))

  if (!photo) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json(photo)
}
