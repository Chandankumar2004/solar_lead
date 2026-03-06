/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@solar/shared"],
  experimental: {
    typedRoutes: true
  },
  webpack: (config) => {
    config.resolve = config.resolve || {};
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias || {}),
      ".js": [".ts", ".tsx", ".js"],
      ".mjs": [".mts", ".mjs"]
    };
    return config;
  }
};

export default nextConfig;
