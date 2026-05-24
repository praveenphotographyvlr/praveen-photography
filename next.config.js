/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['mongoose'],
  images: {
    // Allow Next.js <Image> to load thumbnails from Cloudflare R2 public URL
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.r2.dev',
        pathname: '/**',
      },
      // Add your custom domain here if you use one, e.g.:
      // { protocol: 'https', hostname: 'assets.yourdomain.com', pathname: '/**' },
    ],
  },
}
module.exports = nextConfig
