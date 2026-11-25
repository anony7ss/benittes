import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  skipTrailingSlashRedirect: true,
  allowedDevOrigins: ["192.168.0.103", "localhost", "127.0.0.1"],
  images: {
    unoptimized: true,
  },
  env: {
    NEXT_PUBLIC_SUPABASE_URL:
      process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL || "",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
      process.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
      "",
    NEXT_PUBLIC_SITE_URL:
      process.env.NEXT_PUBLIC_SITE_URL || process.env.PUBLIC_SITE_URL || "",
    NEXT_PUBLIC_WHATSAPP:
      process.env.NEXT_PUBLIC_WHATSAPP || process.env.PUBLIC_WHATSAPP || "",
    NEXT_PUBLIC_EMAIL:
      process.env.NEXT_PUBLIC_EMAIL || process.env.PUBLIC_EMAIL || "",
    NEXT_PUBLIC_INSTAGRAM:
      process.env.NEXT_PUBLIC_INSTAGRAM || process.env.PUBLIC_INSTAGRAM || "",
  },
};

export default nextConfig;
