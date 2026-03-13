import "dotenv/config";

const prismaConfig = {
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations"
  },
  datasource: {
    url: process.env.DATABASE_URL,
    directUrl: process.env.DIRECT_URL
  }
} as const;

export default prismaConfig;
