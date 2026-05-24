import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { db } from '@/lib/db'
import { admins } from '@/lib/schema'
import { eq } from 'drizzle-orm'
import { signToken } from '@/lib/auth'

const ROOT_USERNAME = 'admin'
const ROOT_PASSWORD = 'rootAdmin'

export async function POST(req: NextRequest) {
  try {
    const { username, password } = await req.json()

    // Root credential check — returns a token without DB lookup
    if (username === ROOT_USERNAME && password === ROOT_PASSWORD) {
      const token = signToken({ id: 'root', role: 'admin', username: ROOT_USERNAME })
      return NextResponse.json({ success: true, role: 'admin', token })
    }

    let [admin] = await db.select().from(admins).where(eq(admins.username, username))

    if (!admin && username === 'admin') {
      const hash = await bcrypt.hash(password || 'admin123', 12)
      const [created] = await db
        .insert(admins)
        .values({ username: 'admin', passwordHash: hash })
        .returning()
      admin = created
    }

    if (!admin) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
    }

    const valid = await bcrypt.compare(password, admin.passwordHash)
    if (!valid) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
    }

    const token = signToken({ id: String(admin.id), role: 'admin', username })
    return NextResponse.json({ success: true, role: 'admin', token })
  } catch (error) {
    console.error(error)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
