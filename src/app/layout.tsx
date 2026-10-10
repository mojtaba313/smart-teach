import type { Metadata, Viewport } from 'next'
import './globals.css'
import 'katex/dist/katex.min.css'
import { Toasts } from '../components/ui/overlay'
import { BootSync } from './BootSync'

export const metadata: Metadata = {
  title: 'استودیوی تدریس — Smart Teach Studio',
  icons: { icon: '/favicon.svg' },
  description: 'ارائهٔ آموزشی فارسی با بانک سؤال و استودیوی انیمیشن',
}

export const viewport: Viewport = {
  themeColor: '#f8fafc',
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fa" dir="rtl" suppressHydrationWarning>
      <body className="bg-canvas font-vazir text-ink antialiased">
        <Toasts />
        <BootSync />
        {children}
      </body>
    </html>
  )
}
