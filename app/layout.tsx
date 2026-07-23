import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'MRHB Analytics',
  description: 'Management dashboard for MRHB Network',
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
