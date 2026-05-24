import type { Metadata } from 'next'
import './globals.css'
import { LogoProvider } from '@/app/context/LogoContext'

export const metadata: Metadata = {
  title: 'Praveen Photography',
  description: 'Capturing your precious moments with artistry and elegance',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <LogoProvider>{children}</LogoProvider>
      </body>
    </html>
  )
}
