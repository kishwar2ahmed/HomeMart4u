import React from "react";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { MenuClient } from "../MenuClient";

export const revalidate = 60;

export default async function CategoryPage({
  params,
}: {
  params: Promise<{ category: string }>;
}) {
  const { category: categorySlug } = await params;

  const currentCategory = await prisma.category.findUnique({
    where: { slug: categorySlug },
  });

  if (!currentCategory) {
    notFound();
  }

  const categories = await prisma.category.findMany({
    where: { isActive: true },
    orderBy: { displayOrder: "asc" },
  });

  const products = await prisma.product.findMany({
    where: { isActive: true },
    orderBy: { displayOrder: "asc" },
    include: {
      category: { select: { id: true, name: true, slug: true, department: true } },
      variants: { orderBy: { priceMinor: "asc" } },
      customizationGroups: {
        include: { options: { where: { isActive: true } } },
      },
    },
  });

  const isGroceryCategory =
    currentCategory.department === "GROCERY" ||
    [
      "dairy-eggs-bread",
      "atta-rice-dal",
      "oils-ghee",
      "spices-masalas",
      "fresh-vegetables",
      "tea-beverages",
    ].includes(currentCategory.slug);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
      <div className="mb-8">
        <span className="text-xs uppercase font-semibold text-amberGold-600 tracking-wider">
          Category
        </span>
        <h1 className="font-serif text-3xl sm:text-4xl font-medium text-charcoal-700 mt-1">
          {currentCategory.name}
        </h1>
        {currentCategory.description && (
          <p className="text-xs text-charcoal-500 mt-1 max-w-xl">
            {currentCategory.description}
          </p>
        )}
      </div>

      <React.Suspense fallback={<div className="p-8 text-center text-xs text-stone-400">Loading category...</div>}>
        <MenuClient
          initialCategories={categories}
          initialProducts={products as any}
          defaultCategorySlug={categorySlug}
          defaultDepartment={isGroceryCategory ? "GROCERY" : "MEAT"}
        />
      </React.Suspense>
    </div>
  );
}
