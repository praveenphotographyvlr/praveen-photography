import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { customers, photos } from '@/lib/schema'
import { desc, eq } from 'drizzle-orm'
import { verifyToken, getTokenFromRequest, generateAccessCode } from '@/lib/auth'
import { v4 as uuidv4 } from 'uuid'

function adminAuth(req: NextRequest) {
  const token = getTokenFromRequest(req)
  if (!token) return null
  const decoded = verifyToken(token)
  if (!decoded || decoded.role !== 'admin') return null
  return decoded
}

export async function GET(req: NextRequest) {
  if (!adminAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rows = await db.select().from(customers).orderBy(desc(customers.createdAt))

  const savedRows = await db
    .selectDistinct({ customerId: photos.customerId })
    .from(photos)
    .where(eq(photos.savedToFolder, true))

  const deliveredIds = new Set(savedRows.map(r => r.customerId))

  return NextResponse.json(rows.map(c => ({ ...c, isDelivered: deliveredIds.has(c.id) })))
}

export async function POST(req: NextRequest) {
  if (!adminAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { name, email, phone, eventName, eventDate, maxSelectCount } = await req.json()
  if (!name || !phone || !eventName) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const accessCode = generateAccessCode()
  const folderId = uuidv4()
  const maxCount = parseInt(maxSelectCount) || 0

  const [customer] = await db
    .insert(customers)
    .values({ name, email, phone, eventName, eventDate, accessCode, folderId, maxSelectCount: maxCount })
    .returning()

  return NextResponse.json(customer, { status: 201 })
}
