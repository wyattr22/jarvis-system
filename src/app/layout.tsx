import type { Metadata } from "next"
import "./globals.css"

export const metadata: Metadata = {
  title: "JARVIS v2",
  description: "Multi-agent self-optimizing trading council",
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full dark">
      <body className="h-full bg-background text-foreground antialiased">{children}</body>
    </html>
  )
}
