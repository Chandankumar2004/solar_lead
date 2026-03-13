import "dotenv/config";

const databaseUrl = process.env.DATABASE_URL?.trim();
const directUrl = process.env.DIRECT_URL?.trim() || databaseUrl;

if (!databaseUrl) {
  throw new Error("Missing DATABASE_URL for Prisma configuration");
}

const prismaConfig = {
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations"
  },
  datasource: {
    url: databaseUrl,
    directUrl
  }
} as const;

export default prismaConfig;
