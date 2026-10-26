const { execSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

async function ensureDb() {
  const prismaClientPath = path.join(process.cwd(), "node_modules", ".prisma", "client", "default.js");
  if (!fs.existsSync(prismaClientPath)) {
    console.log("[ensure-db] Generating Prisma Client...");
    execSync("npx prisma generate", { stdio: "inherit" });
  }
  const { PrismaClient } = require("@prisma/client");
  const prisma = new PrismaClient();
  let needsSetup = false;

  try {
    const productCount = await prisma.product.count();
    const categoryCount = await prisma.category.count();
    const hasMatchbox = await prisma.product.findUnique({ where: { slug: "safety-matchbox" } });
    if (productCount < 32 || categoryCount < 12 || !hasMatchbox) {
      needsSetup = true;
    }
  } catch (err) {
    needsSetup = true;
  } finally {
    await prisma.$disconnect().catch(() => {});
  }

  if (needsSetup) {
    console.log("[ensure-db] Database uninitialized or incomplete. Pushing schema and seeding...");
    execSync("npx prisma db push --accept-data-loss --skip-generate", { stdio: "inherit" });
    execSync("node prisma/seed.cjs", { stdio: "inherit" });
    console.log("[ensure-db] Database ready.");
  } else {
    console.log("[ensure-db] Database verified (32 products including ₹2 Matchbox, 12 categories present).");
  }
}

ensureDb().catch((err) => {
  console.error("[ensure-db] Error ensuring database:", err);
  process.exit(1);
});
