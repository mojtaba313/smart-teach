import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Prisma is a Node-only dependency; keep it out of the client graph.
  serverExternalPackages: ['@prisma/client', '@prisma/adapter-pg', 'pg'],
}

export default nextConfig
