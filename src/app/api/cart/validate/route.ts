import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import {
  calculateDeliveryFeePaise,
  calculateDistanceMeters,
  DEFAULT_SHOP_COORDINATES,
  COD_SURCHARGE_PAISE,
} from "@/lib/delivery";
import { validateMinimumMeatOrder } from "@/lib/minimum-order";
import { evaluateCoupon } from "@/lib/coupons";

export async function POST(req: NextRequest) {
  try {
    const session = await getSessionUser(req);
    const body = await req.json();
    const { items = [], addressId, coordinates, couponCode, paymentMethod = "ONLINE" } = body;

    const errors: string[] = [];
    const itemDetails: any[] = [];
    let subtotalMinor = 0;
    const qualifyingItems: any[] = [];

    if (!Array.isArray(items) || items.length > 50) {
      return NextResponse.json(
        { error: "Cart cannot exceed 50 distinct line items." },
        { status: 400 }
      );
    }

    // 1. Batch-fetch all requested variants & customization options in 2 indexed queries (zero N+1 bottleneck!)
    const variantIds = Array.from(
      new Set(
        items
          .map((i: any) => (typeof i?.variantId === "string" ? i.variantId : ""))
          .filter(Boolean)
      )
    );

    const optionIds = Array.from(
      new Set(
        items.flatMap((i: any) =>
          Array.isArray(i?.customizations)
            ? i.customizations
                .map((c: any) => (typeof c?.optionId === "string" ? c.optionId : ""))
                .filter(Boolean)
            : []
        )
      )
    );

    const [variantsList, optionsList, settingsList] = await Promise.all([
      variantIds.length > 0
        ? prisma.productVariant.findMany({
            where: { id: { in: variantIds } },
            include: { product: { include: { category: true } } },
          })
        : Promise.resolve([]),
      optionIds.length > 0
        ? prisma.customizationOption.findMany({
            where: { id: { in: optionIds }, isActive: true },
          })
        : Promise.resolve([]),
      prisma.systemSetting.findMany({
        where: {
          key: {
            in: [
              "MIN_QUALIFYING_MEAT_GRAMS",
              "minimum_order_meat_grams",
              "SHOP_LAT",
              "SHOP_LNG",
            ],
          },
        },
      }),
    ]);

    const variantMap = new Map(variantsList.map((v) => [v.id, v]));
    const optionMap = new Map(optionsList.map((o) => [o.id, o]));
    const settingMap = new Map(settingsList.map((s) => [s.key, s.value]));

    for (const item of items) {
      const parsedQty =
        typeof item.quantity === "number"
          ? item.quantity
          : parseInt(String(item.quantity || ""), 10);
      if (!Number.isInteger(parsedQty) || parsedQty < 1 || parsedQty > 50) {
        errors.push(`Invalid quantity for requested item. Quantity must be between 1 and 50.`);
        continue;
      }
      const itemQuantity = parsedQty;

      const variant = variantMap.get(item.variantId);
      if (!variant || !variant.product.isActive) {
        errors.push(`A requested product is no longer available in the store.`);
        continue;
      }

      if (!variant.isAvailable || !variant.product.isAvailable) {
        errors.push(`"${variant.product.name} (${variant.name})" is currently OUT OF STOCK.`);
      }

      let customizationTotalDelta = 0;
      const verifiedCustomizations: any[] = [];
      if (item.customizations && Array.isArray(item.customizations)) {
        for (const c of item.customizations) {
          if (c.optionId) {
            const opt = optionMap.get(c.optionId);
            if (opt) {
              customizationTotalDelta += opt.priceDeltaMinor;
              verifiedCustomizations.push({
                optionId: opt.id,
                name: opt.name,
                priceDeltaMinor: opt.priceDeltaMinor,
              });
            }
          }
        }
      }

      const unitPriceMinor = variant.priceMinor + customizationTotalDelta;
      const lineTotalMinor = unitPriceMinor * itemQuantity;
      subtotalMinor += lineTotalMinor;

      const isChickenCategory =
        variant.product.category.slug === "fresh-chicken" ||
        variant.product.category.slug === "masala-special";

      const weightGrams =
        variant.pricingType === "WEIGHT" || variant.quantityUnit === "g"
          ? variant.quantityValue
          : null;

      qualifyingItems.push({
        isQualifyingMeat: isChickenCategory,
        weightGrams,
        quantity: itemQuantity,
      });

      itemDetails.push({
        productId: variant.productId,
        variantId: variant.id,
        productName: variant.product.name,
        variantName: variant.name,
        quantity: itemQuantity,
        unitPriceMinor,
        lineTotalMinor,
        isQualifyingMeat: isChickenCategory,
        weightGrams,
        customizations: verifiedCustomizations,
      });
    }

    // 2. Validate Minimum Meat Rule (No 1kg restriction; 0 default)
    const minMeatVal =
      settingMap.get("MIN_QUALIFYING_MEAT_GRAMS") ??
      settingMap.get("minimum_order_meat_grams");
    const minMeatThreshold = minMeatVal ? parseInt(minMeatVal, 10) || 0 : 0;
    const meatValidation = validateMinimumMeatOrder(qualifyingItems, minMeatThreshold);
    if (!meatValidation.isValid && items.length > 0) {
      errors.push(meatValidation.message || "Minimum meat requirement not met.");
    }

    // 3. Determine delivery location & calculate distance
    let deliveryDistanceMeters = 0;
    let deliveryFeeMinor = 0;
    let targetCoords = coordinates;

    if (addressId && !String(addressId).startsWith("guest_")) {
      const address = await prisma.address.findUnique({
        where: { id: String(addressId) },
      });
      if (address) {
        targetCoords = { lat: address.latitude, lng: address.longitude };
      }
    }

    if (targetCoords?.lat != null && targetCoords?.lng != null) {
      const shopCoords = {
        lat: settingMap.get("SHOP_LAT")
          ? parseFloat(settingMap.get("SHOP_LAT")!)
          : DEFAULT_SHOP_COORDINATES.lat,
        lng: settingMap.get("SHOP_LNG")
          ? parseFloat(settingMap.get("SHOP_LNG")!)
          : DEFAULT_SHOP_COORDINATES.lng,
      };

      const targetLat = parseFloat(String(targetCoords.lat));
      const targetLng = parseFloat(String(targetCoords.lng));

      if (Number.isFinite(targetLat) && Number.isFinite(targetLng)) {
        deliveryDistanceMeters = calculateDistanceMeters(
          shopCoords.lat,
          shopCoords.lng,
          targetLat,
          targetLng
        );

        deliveryFeeMinor = calculateDeliveryFeePaise(deliveryDistanceMeters);
      }
    }

    // 4. Validate Coupon (Strict Admin-Controlled Verification)
    let discountMinor = 0;
    let couponResult: any = null;

    if (couponCode && String(couponCode).trim()) {
      const cleanCode = String(couponCode).trim().toUpperCase();
      const coupon = await prisma.coupon.findUnique({
        where: { code: cleanCode },
      });

      if (!coupon) {
        errors.push(`Coupon code "${cleanCode}" does not exist or is not active.`);
      } else {
        const [userUsageCount, totalUsageCount] = await Promise.all([
          session
            ? prisma.couponRedemption.count({
                where: { couponId: coupon.id, userId: session.id },
              })
            : Promise.resolve(0),
          prisma.couponRedemption.count({
            where: { couponId: coupon.id },
          }),
        ]);

        const evaluation = evaluateCoupon(
          coupon,
          subtotalMinor,
          deliveryFeeMinor,
          userUsageCount,
          totalUsageCount
        );
        if (!evaluation.isValid) {
          errors.push(evaluation.message || "Coupon cannot be applied to this order.");
        } else {
          discountMinor = evaluation.discountMinor;
          couponResult = {
            id: coupon.id,
            code: coupon.code,
            discountMinor: evaluation.discountMinor,
            isFreeDelivery: evaluation.isFreeDelivery,
          };
        }
      }
    }

    // 5. COD Surcharge
    const codFeeMinor = paymentMethod === "COD" && items.length > 0 ? COD_SURCHARGE_PAISE : 0;

    // 6. Final Total
    const totalMinor = Math.max(
      0,
      subtotalMinor - discountMinor + deliveryFeeMinor + codFeeMinor
    );

    return NextResponse.json({
      isValid: errors.length === 0 && items.length > 0,
      subtotalMinor,
      discountMinor,
      deliveryDistanceMeters,
      deliveryFeeMinor,
      codFeeMinor,
      totalMinor,
      qualifyingMeatGrams: meatValidation.totalGrams,
      isMinMeatMet: meatValidation.isValid,
      meatShortfallGrams: meatValidation.shortfallGrams,
      coupon: couponResult,
      items: itemDetails,
      errors,
    });
  } catch (error) {
    console.error("Cart validation error:", error);
    return NextResponse.json(
      { error: "Failed to validate cart. Please try again." },
      { status: 500 }
    );
  }
}
