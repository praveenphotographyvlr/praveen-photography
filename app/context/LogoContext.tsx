'use client'
import { createContext, useContext, useEffect, useState } from 'react'

const FALLBACK = 'https://pub-4dadf2e7995748c28df0af22c88108dc.r2.dev/praveen-photography/logo/logo%20new.png'

const LogoContext = createContext<string>(FALLBACK)

export function LogoProvider({ children }: { children: React.ReactNode }) {
  const [logoUrl, setLogoUrl] = useState<string>(FALLBACK)

  useEffect(() => {
    fetch('/api/settings')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.logoUrl) setLogoUrl(d.logoUrl) })
      .catch(() => {})
  }, [])

  return <LogoContext.Provider value={logoUrl}>{children}</LogoContext.Provider>
}

export function useLogo() {
  return useContext(LogoContext)
}
