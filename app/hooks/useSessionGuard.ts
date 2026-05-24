'use client'
import { useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { clearSession } from '@/app/utils/session'

const IDLE_LOGOUT_TIMEOUT: number = process.env.IDLE_LOGOUT_TIMEOUT
  ? parseInt(process.env.IDLE_LOGOUT_TIMEOUT, 10)
  : 15 // Default to 15 minutes if not set
const IDLE_MS = IDLE_LOGOUT_TIMEOUT * 60 * 1000 // 20 minutes
const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'click'] as const

export function useSessionGuard() {
  const router = useRouter()
  const loggingOutRef = useRef(false)

  const logout = useCallback(() => {
    if (loggingOutRef.current) return
    loggingOutRef.current = true
    clearSession()
    router.replace('/')
  }, [router])

  useEffect(() => {
    let idleTimer: ReturnType<typeof setTimeout>

    function resetTimer() {
      clearTimeout(idleTimer)
      idleTimer = setTimeout(logout, IDLE_MS)
    }

    resetTimer()
    ACTIVITY_EVENTS.forEach(ev => window.addEventListener(ev, resetTimer, { passive: true }))

    // Intercept all fetch calls — auto-logout on 401
    const originalFetch = window.fetch
    window.fetch = async (...args: Parameters<typeof fetch>) => {
      const response = await originalFetch(...args)
      if (response.status === 401) logout()
      return response
    }

    return () => {
      clearTimeout(idleTimer)
      ACTIVITY_EVENTS.forEach(ev => window.removeEventListener(ev, resetTimer))
      window.fetch = originalFetch
    }
  }, [logout])
}
