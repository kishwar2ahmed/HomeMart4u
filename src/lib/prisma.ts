import { PrismaClient } from "@prisma/client";
import { execSync } from "node:child_process";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  dbInitialized: boolean | undefined;
  walConfigured: boolean | undefined;
};

function configureSqlitePragmas(client: PrismaClient) {
  if (globalForPrisma.walConfigured) return;
  globalForPrisma.walConfigured = true;
  // Configure WAL mode, normal synchronous, and 10s busy timeout for high-concurrency traffic
  client
    .$queryRawUnsafe("PRAGMA journal_mode = WAL;")
    .then(() => client.$executeRawUnsafe("PRAGMA synchronous = NORMAL;"))
    .then(() => client.$executeRawUnsafe("PRAGMA busy_timeout = 10000;"))
    .then(() => client.$executeRawUnsafe("PRAGMA temp_store = MEMORY;"))
    .catch(() => {
      // Ignore pragma errors during initial schema push
    });
}

function createPrismaClient(): PrismaClient {
  const baseClient = new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

  configureSqlitePragmas(baseClient);

  const extendedClient = baseClient.$extends({
    query: {
      $allModels: {
        async $allOperations({ args, query }) {
          let lastError: any;
          for (let attempt = 0; attempt < 4; attempt++) {
            try {
              return await query(args);
            } catch (error: any) {
              lastError = error;
              const msg = String(error?.message || "");

              // Auto-initialize DB if schema is uninitialized
              if (
                !globalForPrisma.dbInitialized &&
                (error?.code === "P2021" ||
                  msg.includes("does not exist in the current database") ||
                  msg.includes("Unable to open the database file"))
              ) {
                globalForPrisma.dbInitialized = true;
                try {
                  execSync("node scripts/ensure-db.cjs", { stdio: "inherit" });
                  return await query(args);
                } catch (initErr) {
                  console.error("Failed to auto-initialize SQLite database:", initErr);
                }
              }

              // Automatic backoff retry on transient SQLite lock contention under heavy traffic
              if (
                error?.code === "P1008" ||
                msg.includes("SQLITE_BUSY") ||
                msg.includes("database is locked") ||
                msg.includes("timed out")
              ) {
                const backoffMs = 40 * (attempt + 1) + Math.floor(Math.random() * 30);
                await new Promise((resolve) => setTimeout(resolve, backoffMs));
                continue;
              }

              throw error;
            }
          }
          throw lastError;
        },
      },
    },
  });

  return extendedClient as unknown as PrismaClient;
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();
globalForPrisma.prisma = prisma;
