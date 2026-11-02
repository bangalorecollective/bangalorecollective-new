import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  compress: true,
  poweredByHeader: false,
  experimental: {
    serverActions: {
      bodySizeLimit: '10mb',
    },
    optimizePackageImports: [
      'lucide-react',
      '@heroicons/react',
      'chart.js',
      'framer-motion',
      'react-chartjs-2',
      'date-fns',
      'swiper',
    ],
  },
  images: {
    // Every <Image> goes through lib/image-loader.ts. Uploaded files are resized by Next's
    // built-in optimizer (/_next/image), which on the VPS runs on a long-lived server and keeps
    // resized copies in .next/cache/images, so the serverless cold-start timeouts that made
    // the site use Supabase's resizer do not apply.
    loader: "custom",
    loaderFile: "./lib/image-loader.ts",
    qualities: [60, 75, 85, 100],

    localPatterns: [{ pathname: "/storage/v1/object/public/**" }],

    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.unsplash.com",
        port: "",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "bangalorecollective.com",
        port: "",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "**.bangalorecollective.com",
        port: "",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "img.com",
        port: "",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "**.googleusercontent.com",
        port: "",
        pathname: "/**",
      },
    ],
    formats: ["image/webp"],
    minimumCacheTTL: 5184000,
    deviceSizes: [640, 768, 1024, 1280, 1600, 1920],
    imageSizes: [16, 32, 64, 128, 256, 384],
  },
  output: "standalone",
  trailingSlash: true,
  // Pages still get the trailing slash (middleware.ts adds it); API routes and uploaded files
  // must not be redirected, or every data request and image would cost an extra round trip.
  skipTrailingSlashRedirect: true,
  async redirects() {
    return [
      {
        source: '/',
        destination: '/userinterface/home/',
        permanent: true,
      },
      {
        source: '/product/:id',
        destination: '/userinterface/product/:id/',
        permanent: true,
      },
      {
        source: '/category/:id',
        destination: '/userinterface/category/:id/',
        permanent: true,
      },
    ];
  },
};

export default nextConfig;