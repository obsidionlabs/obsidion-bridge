import type { Metadata } from "next"
import { Geist, Geist_Mono } from "next/font/google"
import Link from "next/link"
import "./globals.css"

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] })

const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] })

export const metadata: Metadata = { title: "Obsidion Bridge", description: "Create or join a bridge" }

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <nav className="flex justify-center p-4">
          <div className="flex gap-6">
            <Link href="/create" className="font-medium hover:underline underline-offset-4">
              Create
            </Link>
            <Link href="/join" className="font-medium hover:underline underline-offset-4">
              Join
            </Link>
          </div>
        </nav>
        <div className="text-center text-sm text-gray-400 mt-4 mb-4">
          Be sure to build the package in the root!{" "}
          <code className="bg-gray-20 px-1 py-0.5 rounded">bun run build:watch</code>
        </div>
        {children}
      </body>
    </html>
  )
}
