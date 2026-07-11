import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      {
        source: "/:path*",
        has: [{ type: "host", value: "portfolio.0x99m.com" }],
        destination: "https://www.0x99m.com/portfolio",
        permanent: true,
      },
      // Railway's proxy forwards the original hostname here rather than in Host.
      {
        source: "/:path*",
        has: [
          {
            type: "header",
            key: "x-forwarded-host",
            value: "portfolio.0x99m.com",
          },
        ],
        destination: "https://www.0x99m.com/portfolio",
        permanent: true,
      },
      {
        source: "/:path*",
        has: [{ type: "host", value: "0x99m.com" }],
        destination: "https://www.0x99m.com/:path*",
        permanent: true,
      },
      {
        source: "/:path*",
        has: [{ type: "header", key: "x-forwarded-host", value: "0x99m.com" }],
        destination: "https://www.0x99m.com/:path*",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
