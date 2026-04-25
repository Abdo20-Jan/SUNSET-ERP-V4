import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

const globalForPrisma = globalThis as unknown as { db?: PrismaClient };

const connectionString =
  process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL!;

// Serverless-friendly pool: one connection per Lambda instance, recycled
// aggressively so stale TCP sockets (closed by Postgres while Lambda was
// frozen) don't cause P1017 "Server has closed the connection" errors.
export const db =
  globalForPrisma.db ??
  new PrismaClient({
    adapter: new PrismaPg({
      connectionString,
      max: 1,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000,
      allowExitOnIdle: true,
      keepAlive: true,
    }),
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.db = db;
