import "server-only";

import crypto from "node:crypto";

import { db } from "@/lib/db";

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

export type CacheScope = "lead-summary" | "sentiment";

function hashKey(scope: CacheScope, payload: string): string {
  return crypto.createHash("sha256").update(`${scope}:${payload}`).digest("hex");
}

async function getCached(key: string): Promise<unknown | null> {
  const row = await db.llmCache.findUnique({ where: { key } });
  if (!row) return null;
  if (row.expiresAt.getTime() < Date.now()) {
    void db.llmCache.delete({ where: { key } }).catch(() => {
      /* expirar best-effort */
    });
    return null;
  }
  try {
    return JSON.parse(row.value);
  } catch {
    return null;
  }
}

async function setCached(
  key: string,
  scope: CacheScope,
  value: unknown,
  ttlMs: number,
): Promise<void> {
  const expiresAt = new Date(Date.now() + ttlMs);
  const json = JSON.stringify(value);
  await db.llmCache.upsert({
    where: { key },
    create: { key, scope, value: json, expiresAt },
    update: { value: json, scope, expiresAt },
  });
}

export async function getOrComputeAi<T>(
  scope: CacheScope,
  payload: string,
  compute: () => Promise<T>,
  ttlMs: number = DEFAULT_TTL_MS,
): Promise<{ value: T; cacheHit: boolean }> {
  const key = hashKey(scope, payload);
  const cached = await getCached(key);
  if (cached !== null) {
    return { value: cached as T, cacheHit: true };
  }
  const fresh = await compute();
  try {
    await setCached(key, scope, fresh, ttlMs);
  } catch (err) {
    console.error("ai-cache setCached failed", { scope, err });
  }
  return { value: fresh, cacheHit: false };
}

export async function purgeExpiredCache(): Promise<{ deleted: number }> {
  const result = await db.llmCache.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  return { deleted: result.count };
}
