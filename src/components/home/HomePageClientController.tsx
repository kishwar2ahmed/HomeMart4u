"use client";

import React, { useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { StorefrontView, StoreProduct } from "./StorefrontView";
import { LandingBlogView } from "./LandingBlogView";
import { BookOpen, ShoppingBag, Sparkles } from "lucide-react";

interface HomePageClientControllerProps {
  products: StoreProduct[];
  categories: { id: string; name: string; slug: string; department?: string; imageUrl?: string | null }[];
}

export const HomePageClientController: React.FC<HomePageClientControllerProps> = ({
  products,
  categories,
}) => {
  const [selectedDept, setSelectedDept] = useState<"ALL" | "GROCERIES" | "MEAT">("ALL");

  const handleEnterStore = (dept?: "ALL" | "GROCERIES" | "MEAT") => {
    if (dept) {
      setSelectedDept(dept);
    } else {
      setSelectedDept("ALL");
    }
    const el = document.getElementById("storefront-catalog-section");
    if (el) {
      el.scrollIntoView({ behavior: "smooth" });
    }
  };

  return (
    <div className="space-y-8">
      {/* Quick Visitor Banner */}
      <div className="bg-stone-900 border-b border-stone-800 text-stone-300 py-2.5 px-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
            <span className="font-medium text-stone-200">
              Welcome to homemart4u Mulbagal &bull; All {products.length} Fresh Groceries &amp; Halal Meat Items Live Below
            </span>
          </div>

          <button
            type="button"
            onClick={() => handleEnterStore("ALL")}
            className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-rose-600 hover:bg-rose-700 text-white font-bold text-[11px] shadow-sm transition"
          >
            <ShoppingBag className="w-3 h-3" />
            <span>Jump to Catalog &darr;</span>
          </button>
        </div>
      </div>

      {/* Main Live Storefront Catalog Section — Always visible so nothing ever vanishes */}
      <section
        id="storefront-catalog-section"
        className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 pt-2 pb-4"
      >
        <StorefrontView
          key={selectedDept}
          products={products}
          categories={categories}
          initialDepartment={selectedDept}
        />
      </section>

      {/* Editorial Hero, Department Cards, Journal Articles & Why Choose Us — Always visible */}
      <LandingBlogView onEnterStore={handleEnterStore} />
    </div>
  );
};
