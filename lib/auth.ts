import jwt from 'jsonwebtoken'
import { NextRequest } from 'next/server'

const JWT_SECRET = process.env.JWT_SECRET || 'praveen_photography_secret_2024'

export function signToken(payload: object, expiresIn = process.env.JWT_EXPIRES_IN || '24h') {
  return jwt.sign(payload, JWT_SECRET, { expiresIn } as jwt.SignOptions)
}

export function verifyToken(token: string) {
  try {
    return jwt.verify(token, JWT_SECRET) as jwt.JwtPayload
  } catch {
    return null
  }
}

export function getTokenFromRequest(req: NextRequest): string | null {
  const authHeader = req.headers.get('authorization')
  if (authHeader?.startsWith('Bearer ')) return authHeader.substring(7)
  return null
}

export function generateAccessCode(): string {
  const digits = Math.floor(100000 + Math.random() * 900000).toString()
  const letters = Math.random().toString(36).substring(2, 5).toUpperCase()
  return `PP${letters}${digits}`
}
