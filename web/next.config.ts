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
    ];
  },
};

export default nextConfig;
