import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { db } from '@/lib/db'
import { admins } from '@/lib/schema'
import { eq } from 'drizzle-orm'
import { verifyToken, getTokenFromRequest } from '@/lib/auth'

function adminAuth(req: NextRequest) {
  const token = getTokenFromRequest(req)
  if (!token) return null
  const decoded = verifyToken(token)
  if (!decoded || decoded.role !== 'admin') return null
  return decoded
}

export async function POST(req: NextRequest) {
  if (!adminAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { username, password, logoUrl } = await req.json()

  if (!username?.trim()) return NextResponse.json({ error: 'Username is required' }, { status: 400 })
  if (!password || password.length < 6) return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 })

  const [existing] = await db.select({ id: admins.id }).from(admins).where(eq(admins.username, username.trim()))
  if (existing) return NextResponse.json({ error: 'Username already exists' }, { status: 409 })

  const passwordHash = await bcrypt.hash(password, 12)
  const [created] = await db
    .insert(admins)
    .values({ username: username.trim(), passwordHash, logoUrl: logoUrl?.trim() || '' })
    .returning({ id: admins.id, username: admins.username, logoUrl: admins.logoUrl })

  return NextResponse.json({ success: true, admin: created }, { status: 201 })
}

export async function GET(req: NextRequest) {
  if (!adminAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rows = await db.select({ id: admins.id, username: admins.username, logoUrl: admins.logoUrl }).from(admins)
  return NextResponse.json(rows)
}
