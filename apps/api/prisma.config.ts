import "dotenv/config";

const databaseUrl = process.env.DATABASE_URL?.trim();
const directUrl = process.env.DIRECT_URL?.trim();

if (!databaseUrl) {
  throw new Error("Missing DATABASE_URL for Prisma configuration");
}

if (!directUrl) {
  throw new Error(
    "Missing DIRECT_URL for Prisma configuration. Use direct DB host (db.onblngbhnigulspucvwg.supabase.co:5432), not pooler."
  );
}

try {
  const directHost = new URL(directUrl).hostname.toLowerCase();
  if (directHost.includes("pooler.supabase.com")) {
    throw new Error(
      "DIRECT_URL must use the direct Supabase host (db.onblngbhnigulspucvwg.supabase.co:5432), not pooler."
    );
  }
} catch (error) {
  if (error instanceof Error && error.message.includes("DIRECT_URL must use")) {
    throw error;
  }
  throw new Error("DIRECT_URL is not a valid URL for Prisma configuration");
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
