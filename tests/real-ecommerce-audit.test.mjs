import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const rootDir = process.cwd();

function getAllSourceFiles(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      getAllSourceFiles(fullPath, files);
    } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      files.push(fullPath);
    }
  }
  return files;
}

describe("Real E-Commerce & Zero-Hardcoded-Fakes Verification Suite", () => {
  it("persists customer contact inquiries via POST /api/contact and connects ContactPage to the backend", () => {
    const contactApiPath = path.join(rootDir, "src/app/api/contact/route.ts");
    assert.ok(fs.existsSync(contactApiPath), "Expected /src/app/api/contact/route.ts to exist");

    const apiCode = fs.readFileSync(contactApiPath, "utf-8");
    assert.ok(
      apiCode.includes("checkRateLimit") &&
        apiCode.includes("isValidIndianMobile") &&
        apiCode.includes("prisma.notificationBroadcast.create") &&
        apiCode.includes("CUSTOMER_CONTACT_INQUIRIES"),
      "Expected POST /api/contact to enforce rate limiting, mobile validation, and Prisma persistence"
    );

    const contactPageCode = fs.readFileSync(
      path.join(rootDir, "src/app/contact/page.tsx"),
      "utf-8"
    );
    assert.ok(
      contactPageCode.includes('fetch("/api/contact"') &&
        contactPageCode.includes('method: "POST"'),
      "Expected ContactPage to submit inquiries to POST /api/contact"
    );
  });

  it("uses real Nominatim reverse geocoding and coordinate-resolved Mulbagal localities in MapProvider", () => {
    const mapProviderCode = fs.readFileSync(
      path.join(rootDir, "src/lib/adapters/MapProvider.ts"),
      "utf-8"
    );
    assert.ok(
      mapProviderCode.includes("nominatim.openstreetmap.org/reverse") &&
        mapProviderCode.includes("resolveNearestMulbagalZone") &&
        mapProviderCode.includes("MULBAGAL_ZONES"),
      "Expected ModularMapProvider to query Nominatim reverse geocoding with coordinate-resolved Mulbagal zone fallback"
    );
  });

  it("calculates real SLA compliance rate from delivered orders in /api/admin/dashboard and binds it in AdminAnalyticsPage", () => {
    const dashboardRouteCode = fs.readFileSync(
      path.join(rootDir, "src/app/api/admin/dashboard/route.ts"),
      "utf-8"
    );
    assert.ok(
      dashboardRouteCode.includes("slaComplianceRate") &&
        dashboardRouteCode.includes("avgDeliveryMinutes") &&
        dashboardRouteCode.includes("SLA_TARGET_MS"),
      "Expected /api/admin/dashboard to compute real slaComplianceRate and avgDeliveryMinutes"
    );

    const analyticsPageCode = fs.readFileSync(
      path.join(rootDir, "src/app/admin/analytics/page.tsx"),
      "utf-8"
    );
    assert.ok(
      analyticsPageCode.includes("metrics.slaComplianceRate") &&
        !analyticsPageCode.includes("97.8%"),
      "Expected AdminAnalyticsPage to render live metrics.slaComplianceRate instead of hardcoded 97.8%"
    );
  });

  it("eliminates all blocking browser alert() and confirm() calls across all src/ files", () => {
    const srcFiles = getAllSourceFiles(path.join(rootDir, "src"));
    for (const file of srcFiles) {
      const content = fs.readFileSync(file, "utf-8");
      const relPath = path.relative(rootDir, file);
      assert.ok(
        !/\b(window\.)?alert\s*\(/.test(content),
        `Found forbidden alert() call in ${relPath}`
      );
      assert.ok(
        !/\b(window\.)?confirm\s*\(/.test(content),
        `Found forbidden confirm() call in ${relPath}`
      );
    }
  });
});
