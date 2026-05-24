import { NextResponse } from 'next/server'

// Session is stored client-side in sessionStorage — no server state to clear.
export async function POST() {
  return NextResponse.json({ success: true })
}
