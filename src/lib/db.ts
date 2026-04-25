import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

const globalForPrisma = globalThis as unknown as { db?: PrismaClient };

export const db =
  globalForPrisma.db ??
  new PrismaClient({
    adapter: new PrismaPg({
      connectionString: process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL!,
    }),
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.db = db;
