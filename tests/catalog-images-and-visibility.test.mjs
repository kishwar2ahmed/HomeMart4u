import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

describe("Catalog Product Image Accuracy & Zero-Vanishing Guarantees", () => {
  const seedPath = path.join(process.cwd(), "prisma", "seed.cjs");
  const seedSource = fs.readFileSync(seedPath, "utf-8");

  const expectedSlugs = [
    "fresh-tender-chicken-curry-cut",
    "premium-boneless-chicken-breast",
    "juicy-chicken-drumsticks",
    "tender-chicken-wings",
    "whole-spring-chicken",
    "chef-special-marinated-chicken-kebab",
    "peri-peri-marinated-chicken-wings",
    "pure-country-desi-nati-eggs",
    "fresh-farm-white-eggs",
    "thums-up-750ml",
    "fresh-rohu-catla-curry-cut",
    "premium-sea-white-prawns",
    "king-fish-seer-fish-steaks",
    "tender-goat-curry-cut",
    "special-goat-biryani-cut",
    "fresh-goat-keema-minced",
    "amul-butter-pasteurized",
    "nandini-fresh-toned-milk",
    "fresh-malai-paneer-cubes",
    "farm-fresh-brown-eggs",
    "india-gate-super-basmati-rice",
    "aashirvaad-shudh-chakki-atta",
    "tata-sampann-unpolished-toor-dal",
    "fortune-sunlite-sunflower-oil",
    "nandini-pure-cow-ghee",
    "everest-chicken-masala",
    "mothers-recipe-ginger-garlic-paste",
    "fresh-red-onions",
    "hybrid-juicy-red-tomatoes",
    "tata-tea-gold",
    "bru-instant-roasted-coffee",
    "safety-matchbox",
  ];

  it("all 32 product slugs have a dedicated local image file in public/images/products/<slug>.jpg", () => {
    assert.equal(expectedSlugs.length, 32);
    for (const slug of expectedSlugs) {
      const imgFile = path.join(process.cwd(), "public", "images", "products", `${slug}.jpg`);
      assert.ok(fs.existsSync(imgFile), `Missing image file for ${slug}: ${imgFile}`);
      const stat = fs.statSync(imgFile);
      assert.ok(stat.size > 5000, `Image file for ${slug} is too small (${stat.size} bytes)`);
      assert.ok(
        seedSource.includes(`/images/products/${slug}.jpg`),
        `Seed file does not reference /images/products/${slug}.jpg`
      );
    }
  });

  it("homepage, menu page, category page, and products API do not filter out unavailable variants", () => {
    const filesToCheck = [
      "src/app/page.tsx",
      "src/app/menu/page.tsx",
      "src/app/menu/[category]/page.tsx",
      "src/app/api/products/route.ts",
    ];
    for (const relPath of filesToCheck) {
      const content = fs.readFileSync(path.join(process.cwd(), relPath), "utf-8");
      assert.ok(
        !content.includes("variants: { where: { isAvailable: true }") &&
          !content.includes("variants: {\n        where: { isAvailable: true }"),
        `${relPath} must not filter out variants with isAvailable: false so Coming Soon items keep their prices`
      );
    }
  });

  it("HomePageClientController always renders both StorefrontView and LandingBlogView without hiding either", () => {
    const controllerContent = fs.readFileSync(
      path.join(process.cwd(), "src/components/home/HomePageClientController.tsx"),
      "utf-8"
    );
    assert.ok(controllerContent.includes("<StorefrontView"), "Must render StorefrontView");
    assert.ok(controllerContent.includes("<LandingBlogView"), "Must render LandingBlogView");
    assert.ok(!controllerContent.includes("if (guestViewingStore)"), "Must not hide LandingBlogView behind toggle");
  });
});
