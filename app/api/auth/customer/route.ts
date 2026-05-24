import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { customers } from '@/lib/schema'
import { eq, sql } from 'drizzle-orm'
import { signToken } from '@/lib/auth'

export async function POST(req: NextRequest) {
  try {
    const { accessCode } = await req.json()

    const [customer] = await db
      .select()
      .from(customers)
      .where(eq(customers.accessCode, accessCode.trim().toUpperCase()))

    if (!customer) {
      return NextResponse.json({ error: 'Invalid access code' }, { status: 401 })
    }

    const token = signToken({
      id: String(customer.id),
      role: 'customer',
      folderId: customer.folderId,
      name: customer.name,
    })
    return NextResponse.json({
      success: true,
      role: 'customer',
      token,
      customerId: String(customer.id),
      customerName: customer.name,
    })
  } catch (error) {
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
