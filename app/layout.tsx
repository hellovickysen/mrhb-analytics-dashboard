import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'MRHB Analytics',
  description: 'Management dashboard for MRHB Network — track website traffic, app installs, SEO, social campaigns, and revenue in one place.',
  icons: {
    icon: '/favicon.ico',
    apple: '/icon-192.png',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className="font-syne">{children}</body>
    </html>
  )
}
