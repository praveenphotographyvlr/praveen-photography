// Client-only — do not import in server components or API routes
const TOKEN_KEY       = 'pp_token'
const CUSTOMER_ID_KEY = 'pp_customer_id'

export function saveAdminSession(token: string) {
  sessionStorage.setItem(TOKEN_KEY, token)
}

export function saveCustomerSession(token: string, customerId: string) {
  sessionStorage.setItem(TOKEN_KEY, token)
  sessionStorage.setItem(CUSTOMER_ID_KEY, customerId)
}

export function getToken(): string | null {
  try { return sessionStorage.getItem(TOKEN_KEY) } catch { return null }
}

export function getCustomerId(): string | null {
  try { return sessionStorage.getItem(CUSTOMER_ID_KEY) } catch { return null }
}

export function clearSession() {
  try {
    sessionStorage.removeItem(TOKEN_KEY)
    sessionStorage.removeItem(CUSTOMER_ID_KEY)
  } catch {}
}

export function authHeaders(): Record<string, string> {
  const token = getToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export function getSessionRole(): 'admin' | 'customer' | null {
  const token = getToken()
  if (!token) return null
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const payload = JSON.parse(atob(parts[1]))
    if (payload.exp && payload.exp * 1000 < Date.now()) {
      clearSession()
      return null
    }
    if (payload.role === 'admin') return 'admin'
    if (payload.role === 'customer') return 'customer'
    return null
  } catch { return null }
}
