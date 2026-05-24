/**
 * lib/r2.ts
 *
 * Server-side Cloudflare R2 helpers.
 * Uses the AWS S3-compatible REST API — just fetch + AWS Signature V4 (no SDK dependency).
 *
 * Required env vars:
 *   R2_ACCOUNT_ID          — Cloudflare account ID
 *   R2_ACCESS_KEY_ID       — R2 API token Access Key ID
 *   R2_SECRET_ACCESS_KEY   — R2 API token Secret Access Key
 *   R2_BUCKET_NAME         — R2 bucket name
 *   R2_PUBLIC_URL          — Public URL for the bucket (e.g. https://pub-xxx.r2.dev or custom domain)
 */

import crypto from 'crypto'
import { setDefaultResultOrder } from 'dns'

// Force IPv4 — Node 18+ prefers IPv6 but some networks can't reach Cloudflare over IPv6
setDefaultResultOrder('ipv4first')

const ACCOUNT_ID       = process.env.R2_ACCOUNT_ID!
const ACCESS_KEY_ID    = process.env.R2_ACCESS_KEY_ID!
const SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY!
const BUCKET_NAME      = process.env.R2_BUCKET_NAME!
const PUBLIC_URL       = process.env.R2_PUBLIC_URL!

if (!ACCOUNT_ID || !ACCESS_KEY_ID || !SECRET_ACCESS_KEY || !BUCKET_NAME || !PUBLIC_URL) {
  throw new Error(
    'Missing R2 env vars. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, R2_PUBLIC_URL.'
  )
}

const R2_ENDPOINT = `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`
const REGION = 'auto'
const SERVICE = 's3'

// ── AWS Signature V4 helpers ──────────────────────────────────────────────

function hmacSHA256(key: Buffer | string, data: string): Buffer {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest()
}

function sha256Hex(data: string | Buffer): string {
  return crypto.createHash('sha256').update(data).digest('hex')
}

function getSigningKey(dateStamp: string): Buffer {
  const kDate    = hmacSHA256(`AWS4${SECRET_ACCESS_KEY}`, dateStamp)
  const kRegion  = hmacSHA256(kDate, REGION)
  const kService = hmacSHA256(kRegion, SERVICE)
  const kSigning = hmacSHA256(kService, 'aws4_request')
  return kSigning
}

function formatDate(d: Date): { dateStamp: string; amzDate: string } {
  const iso = d.toISOString().replace(/[:-]|\.\d{3}/g, '')
  return { dateStamp: iso.slice(0, 8), amzDate: iso.slice(0, 15) + 'Z' }
}

/**
 * Sign and send a request to R2 using AWS Signature V4.
 */
async function r2Request(
  method: 'PUT' | 'DELETE' | 'GET',
  objectKey: string,
  body?: Buffer,
  contentType?: string
): Promise<Response> {
  const now = new Date()
  const { dateStamp, amzDate } = formatDate(now)

  const url = `${R2_ENDPOINT}/${BUCKET_NAME}/${objectKey}`
  const payloadHash = body ? sha256Hex(body) : sha256Hex('')

  const headers: Record<string, string> = {
    host: `${ACCOUNT_ID}.r2.cloudflarestorage.com`,
    'x-amz-date': amzDate,
    'x-amz-content-sha256': payloadHash,
  }
  if (contentType) headers['content-type'] = contentType
  if (body)        headers['content-length'] = String(body.length)

  // Canonical headers (sorted)
  const sortedHeaderKeys = Object.keys(headers).sort()
  const canonicalHeaders = sortedHeaderKeys.map(k => `${k}:${headers[k]}`).join('\n') + '\n'
  const signedHeaders    = sortedHeaderKeys.join(';')

  const canonicalRequest = [
    method,
    `/${BUCKET_NAME}/${objectKey}`,
    '',   // no query string
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n')

  const credentialScope = `${dateStamp}/${REGION}/${SERVICE}/aws4_request`
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n')

  const signingKey = getSigningKey(dateStamp)
  const signature  = hmacSHA256(signingKey, stringToSign).toString('hex')

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${ACCESS_KEY_ID}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`

  const fetchHeaders: Record<string, string> = {
    ...headers,
    Authorization: authorization,
  }
  // Remove 'host' — fetch sets it automatically (and some runtimes reject explicit host)
  delete fetchHeaders['host']

  return fetch(url, {
    method,
    headers: fetchHeaders,
    body: body ? new Uint8Array(body) : undefined,
    signal: AbortSignal.timeout(30000),
  })
}

// ── Public API ────────────────────────────────────────────────────────────

/** Result returned after a successful thumbnail upload */
export interface R2UploadResult {
  object_key: string  // e.g. "praveen-photography/thumbnails/abc123.jpg"
  public_url: string  // e.g. "https://pub-xxx.r2.dev/praveen-photography/thumbnails/abc123.jpg"
}

/**
 * Upload a base64-encoded thumbnail to Cloudflare R2.
 *
 * @param base64Data  Raw base64 string (no data-URI prefix)
 * @param mimeType    e.g. "image/jpeg"
 * @param folder      R2 folder path, default "praveen-photography/thumbnails"
 * @returns           { object_key, public_url }
 */
export async function uploadThumbnailToR2(
  base64Data: string,
  mimeType: string = 'image/jpeg',
  folder: string = 'praveen-photography/thumbnails'
): Promise<R2UploadResult> {
  const ext        = mimeType.split('/')[1] || 'jpg'
  const uniqueId   = crypto.randomUUID()
  const objectKey  = `${folder}/${uniqueId}.${ext}`
  const body       = Buffer.from(base64Data, 'base64')

  const res = await r2Request('PUT', objectKey, body, mimeType)

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`R2 upload failed (${res.status}): ${err}`)
  }

  const publicUrl = `${PUBLIC_URL.replace(/\/$/, '')}/${objectKey}`
  return { object_key: objectKey, public_url: publicUrl }
}

/**
 * Delete an object from Cloudflare R2 by its object key.
 * Called when a photo record is deleted.
 */
export async function deleteThumbnailFromR2(objectKey: string): Promise<void> {
  const res = await r2Request('DELETE', objectKey)

  if (!res.ok) {
    const err = await res.text()
    // Log but don't throw — a failed deletion shouldn't break the main flow
    console.error(`R2 delete failed for ${objectKey} (${res.status}): ${err}`)
  }
}
