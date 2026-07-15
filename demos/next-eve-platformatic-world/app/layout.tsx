import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import './styles.css'

export const metadata: Metadata = {
  title: 'Velocity Campaign Launch',
  description: 'A live campaign orchestrated by Eve and durably executed with Platformatic World.'
}

export default function RootLayout ({ children }: { children: ReactNode }) {
  return (
    <html lang='en'>
      <body>{children}</body>
    </html>
  )
}
