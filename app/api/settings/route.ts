import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { admins } from '@/lib/schema'

export async function GET() {
  const [admin] = await db.select({ logoUrl: admins.logoUrl }).from(admins).limit(1)
  return NextResponse.json({ logoUrl: admin?.logoUrl ?? '' })
}
