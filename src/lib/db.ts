import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

const connectionString =
  process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL!;

function buildClient(): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaPg({
      connectionString,
      max: 3,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000,
      keepAlive: true,
    }),
  });
}

const globalForPrisma = globalThis as unknown as {
  prismaBase?: PrismaClient;
};

let baseClient: PrismaClient =
  globalForPrisma.prismaBase ?? buildClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prismaBase = baseClient;
}

function isConnectionError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as {
    code?: string;
    message?: string;
    cause?: { message?: string };
  };
  if (e.code === "P1017") return true;
  const msg = `${e.message ?? ""} ${e.cause?.message ?? ""}`;
  return (
    msg.includes("Server has closed the connection") ||
    msg.includes("ConnectionClosed") ||
    msg.includes("timeout exceeded when trying to connect")
  );
}

let rebuildInFlight: Promise<void> | null = null;

async function rebuild(): Promise<void> {
  if (rebuildInFlight) return rebuildInFlight;
  rebuildInFlight = (async () => {
    console.warn("[db] rebuilding pool after connection error");
    const old = baseClient;
    baseClient = buildClient();
    if (process.env.NODE_ENV !== "production") {
      globalForPrisma.prismaBase = baseClient;
    }
    // Fire-and-forget the disconnect of the old pool so concurrent retries
    // that may still be reading from the soon-to-die client don't get
    // their socket yanked out from under them.
    old.$disconnect().catch(() => {});
    rebuildInFlight = null;
  })();
  return rebuildInFlight;
}

type AnyFn = (...args: unknown[]) => unknown;
type AnyRec = Record<string | symbol, unknown>;

async function withRetryGeneric<T>(
  label: string,
  fn: () => Promise<T>,
): Promise<T> {
  let attempt = 0;
  // Allow up to 2 retries because: 1st failure triggers rebuild, but a new
  // pool may also surface a stale conn (Postgres limits, brief net blip).
  while (true) {
    try {
      return await fn();
    } catch (err) {
      if (!isConnectionError(err) || attempt >= 2) {
        if (isConnectionError(err)) {
          console.error(`[db] ${label} exhausted retries`, err);
        }
        throw err;
      }
      attempt++;
      console.warn(
        `[db] ${label} attempt ${attempt} failed with connection error, retrying`,
      );
      await rebuild();
    }
  }
}

function withRetry(
  modelKey: string | symbol,
  methodKey: string | symbol,
): AnyFn {
  return async (...args: unknown[]) => {
    return withRetryGeneric(`${String(modelKey)}.${String(methodKey)}`, () => {
      const delegate = (baseClient as unknown as AnyRec)[modelKey] as AnyRec;
      const method = delegate[methodKey] as AnyFn;
      return method.apply(delegate, args) as Promise<unknown>;
    });
  };
}

function wrapTopLevelFn(methodKey: string | symbol): AnyFn {
  return async (...args: unknown[]) => {
    return withRetryGeneric(String(methodKey), () => {
      const fn = (baseClient as unknown as AnyRec)[methodKey] as AnyFn;
      return fn.apply(baseClient, args) as Promise<unknown>;
    });
  };
}

export const db = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const value = (baseClient as unknown as AnyRec)[prop as string];

    // $transaction, $queryRaw, $executeRaw etc. — wrap with retry
    if (typeof prop === "string" && prop.startsWith("$")) {
      if (typeof value === "function") return wrapTopLevelFn(prop);
      return value;
    }

    // Model delegates (objects with methods like findMany, count, ...)
    if (typeof value === "object" && value !== null) {
      const modelKey = prop;
      return new Proxy(value as AnyRec, {
        get(modelTarget, methodKey) {
          const method = (modelTarget as AnyRec)[methodKey as string];
          if (typeof method !== "function") return method;
          return withRetry(modelKey, methodKey);
        },
      });
    }

    if (typeof value === "function") {
      return (value as AnyFn).bind(baseClient);
    }
    return value;
  },
}) as PrismaClient;
