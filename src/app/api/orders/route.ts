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
import { notificationProvider } from "@/lib/adapters/NotificationProvider";
import { autoAssignDeliveryPartner } from "@/lib/delivery-assignment";
import { checkRateLimit, getClientIp } from "@/lib/rate-limiter";
import { sanitizeText, sanitizeAddress } from "@/lib/security";

export async function GET(req: NextRequest) {
  try {
    const session = await getSessionUser(req);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const orders = await prisma.order.findMany({
      where: { userId: session.id },
      orderBy: { createdAt: "desc" },
      include: {
        items: true,
        payment: true,
        deliveryAssignment: {
          include: {
            agent: { select: { id: true, name: true, mobile: true } },
          },
        },
        review: true,
      },
    });

    return NextResponse.json({ orders });
  } catch (error) {
    console.error("Error fetching orders:", error);
    return NextResponse.json({ error: "Failed to load orders." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSessionUser(req);
    if (!session) {
      return NextResponse.json(
        { error: "Please log in or register to place your order." },
        { status: 401 }
      );
    }

    const ip = getClientIp(req);
    const rateLimit = checkRateLimit(`order:${session.id}:${ip}`, { maxRequests: 15, windowMs: 60 * 1000 });
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: "Too many order requests. Please wait a moment before trying again." },
        { status: 429 }
      );
    }

    const body = await req.json();
    const {
      items = [],
      addressId,
      customAddress,
      couponCode,
      paymentMethod: rawPaymentMethod = "COD",
      notes,
      existingOrderId,
      orderId,
    } = body;

    const ALLOWED_PAYMENT_METHODS = [
      "COD",
      "ONLINE",
      "UPI_QR",
      "RAZORPAY",
      "PHONEPE",
      "GOOGLE_PAY",
      "GPAY",
      "PAYTM",
      "MOBIKWIK",
      "BHIM",
      "UPI",
    ];
    const paymentMethod = String(rawPaymentMethod || "COD").trim().toUpperCase();
    if (!ALLOWED_PAYMENT_METHODS.includes(paymentMethod)) {
      return NextResponse.json(
        { error: "Invalid payment method selected." },
        { status: 400 }
      );
    }

    const sanitizedNotes = notes ? sanitizeText(notes, 300) : null;

    // Auto-expire abandoned unpaid online PLACED orders older than 5 minutes so retries are never blocked
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    await prisma.order.updateMany({
      where: {
        userId: session.id,
        status: "PLACED",
        createdAt: { lt: fiveMinutesAgo },
        payment: {
          method: { not: "COD" },
          status: { in: ["PENDING", "FAILED"] },
        },
      },
      data: {
        status: "CANCELLED",
        cancellationReason: "Expired unpaid online payment session",
        cancelledAt: new Date(),
      },
    });

    // Anti-Flood Guard: Prevent a single user from accumulating excessive unconfirmed PLACED orders
    const checkOrderId = existingOrderId || orderId;
    if (!checkOrderId && session.role === "CUSTOMER") {
      const activePlacedCount = await prisma.order.count({
        where: {
          userId: session.id,
          status: "PLACED",
        },
      });
      if (activePlacedCount >= 5) {
        return NextResponse.json(
          {
            error:
              "You already have 5 active unconfirmed orders pending. Please complete or wait for confirmation on your existing orders before placing more.",
          },
          { status: 429 }
        );
      }
    }
    if (checkOrderId) {
      const existingOrder = await prisma.order.findFirst({
        where: { id: checkOrderId, userId: session.id },
        include: { payment: true, items: true },
      });

      if (
        existingOrder &&
        existingOrder.status === "PLACED" &&
        existingOrder.payment?.status !== "COMPLETED"
      ) {
        if (paymentMethod === "COD") {
          const codFeeMinor = COD_SURCHARGE_PAISE;
          const newTotalMinor = Math.max(
            0,
            existingOrder.subtotalMinor - existingOrder.discountMinor + existingOrder.deliveryFeeMinor + codFeeMinor
          );

          const updated = await prisma.$transaction(async (tx) => {
            const o = await tx.order.update({
              where: { id: existingOrder.id },
              data: {
                codFeeMinor,
                totalMinor: newTotalMinor,
                updatedAt: new Date(),
              },
            });

            const p = await tx.payment.upsert({
              where: { orderId: existingOrder.id },
              update: {
                method: "COD",
                provider: "CASH_ON_DELIVERY",
                status: "PENDING",
                amountMinor: newTotalMinor,
                providerReference: `COD_${existingOrder.orderNumber}_${Date.now()}`,
                updatedAt: new Date(),
              },
              create: {
                orderId: existingOrder.id,
                method: "COD",
                provider: "CASH_ON_DELIVERY",
                status: "PENDING",
                amountMinor: newTotalMinor,
                providerReference: `COD_${existingOrder.orderNumber}_${Date.now()}`,
              },
            });

            await tx.auditLog.create({
              data: {
                actorUserId: session.id,
                action: "ORDER_SWITCHED_TO_COD_FROM_CHECKOUT",
                entityType: "ORDER",
                entityId: existingOrder.id,
                metadataJson: JSON.stringify({
                  orderNumber: existingOrder.orderNumber,
                  reusedExistingOrder: true,
                  newTotalMinor,
                }),
              },
            });

            return { ...o, payment: p };
          });

          return NextResponse.json({
            success: true,
            order: updated,
            reusedExistingOrder: true,
            message: "Existing order updated to COD without duplication.",
          });
        } else {
          // Reuse existing unpaid order for Online / UPI payment without creating duplicates
          const newTotalMinor = Math.max(
            0,
            existingOrder.subtotalMinor - existingOrder.discountMinor + existingOrder.deliveryFeeMinor
          );

          const updated = await prisma.$transaction(async (tx) => {
            const o = await tx.order.update({
              where: { id: existingOrder.id },
              data: {
                codFeeMinor: 0,
                totalMinor: newTotalMinor,
                updatedAt: new Date(),
              },
            });

            const p = await tx.payment.upsert({
              where: { orderId: existingOrder.id },
              update: {
                method: paymentMethod,
                provider: "UPI_DYNAMIC_QR",
                status: "PENDING",
                amountMinor: newTotalMinor,
                providerReference: `UPI_${existingOrder.orderNumber}_${Date.now()}`,
                updatedAt: new Date(),
              },
              create: {
                orderId: existingOrder.id,
                method: paymentMethod,
                provider: "UPI_DYNAMIC_QR",
                status: "PENDING",
                amountMinor: newTotalMinor,
                providerReference: `UPI_${existingOrder.orderNumber}_${Date.now()}`,
              },
            });

            return { ...o, payment: p, items: existingOrder.items };
          });

          return NextResponse.json({
            success: true,
            order: updated,
            reusedExistingOrder: true,
            message: "Existing unpaid order reused for online UPI payment.",
          });
        }
      }
    }

    if (!items || items.length === 0) {
      return NextResponse.json({ error: "Your cart is empty." }, { status: 400 });
    }

    // Determine delivery address
    let deliveryAddressObj: any = null;
    if (addressId) {
      deliveryAddressObj = await prisma.address.findFirst({
        where: { id: addressId, userId: session.id },
      });
    } else if (customAddress && customAddress.addressLine) {
      deliveryAddressObj = sanitizeAddress(customAddress);
    }

    if (!deliveryAddressObj || deliveryAddressObj.latitude == null || deliveryAddressObj.longitude == null) {
      return NextResponse.json(
        { error: "A valid delivery address in Mulbagal is required." },
        { status: 400 }
      );
    }

    const destLat = parseFloat(String(deliveryAddressObj.latitude));
    const destLng = parseFloat(String(deliveryAddressObj.longitude));
    if (isNaN(destLat) || isNaN(destLng)) {
      return NextResponse.json(
        { error: "Invalid delivery coordinates." },
        { status: 400 }
      );
    }

    // 1. Validate item quantities and batch-fetch all variants, customization options, and system settings in parallel (eliminates N+1 queries under heavy traffic)
    const variantIds = new Set<string>();
    const optionIds = new Set<string>();

    for (const item of items) {
      const parsedQty = typeof item.quantity === "number" ? item.quantity : parseInt(String(item.quantity || ""), 10);
      if (!Number.isInteger(parsedQty) || parsedQty < 1 || parsedQty > 50) {
        return NextResponse.json(
          { error: `Invalid quantity for item "${item.variantId || "cart item"}". Quantity must be a whole number between 1 and 50.` },
          { status: 400 }
        );
      }
      if (!item.variantId || typeof item.variantId !== "string") {
        return NextResponse.json(
          { error: "Invalid product variant selection in cart." },
          { status: 400 }
        );
      }
      variantIds.add(item.variantId);
      if (item.customizations && Array.isArray(item.customizations)) {
        for (const c of item.customizations) {
          if (c?.optionId && typeof c.optionId === "string") {
            optionIds.add(c.optionId);
          }
        }
      }
    }

    const [variantsList, optionsList, systemSettingsList] = await Promise.all([
      prisma.productVariant.findMany({
        where: { id: { in: Array.from(variantIds) } },
        include: {
          product: { include: { category: true } },
        },
      }),
      optionIds.size > 0
        ? prisma.customizationOption.findMany({
            where: { id: { in: Array.from(optionIds) } },
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
    const settingsMap = new Map(systemSettingsList.map((s) => [s.key, s.value]));

    let subtotalMinor = 0;
    const qualifyingMeatItems: any[] = [];
    const preparedOrderItems: any[] = [];

    for (const item of items) {
      const itemQuantity = typeof item.quantity === "number" ? item.quantity : parseInt(String(item.quantity), 10);
      const variant = variantMap.get(item.variantId);

      if (!variant || !variant.product.isActive) {
        return NextResponse.json(
          { error: `Item is no longer available in the store.` },
          { status: 400 }
        );
      }

      if (!variant.isAvailable || !variant.product.isAvailable) {
        return NextResponse.json(
          { error: `"${variant.product.name} (${variant.name})" is currently OUT OF STOCK.` },
          { status: 400 }
        );
      }

      let customizationTotalDelta = 0;
      const verifiedCustomizations: any[] = [];
      if (item.customizations && Array.isArray(item.customizations)) {
        for (const c of item.customizations) {
          if (c.optionId) {
            const opt = optionMap.get(c.optionId);
            if (opt && opt.isActive) {
              customizationTotalDelta += opt.priceDeltaMinor;
              verifiedCustomizations.push({
                group: c.group || "Customization",
                option: opt.name,
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

      qualifyingMeatItems.push({
        isQualifyingMeat: isChickenCategory,
        weightGrams,
        quantity: itemQuantity,
      });

      preparedOrderItems.push({
        productId: variant.productId,
        variantId: variant.id,
        productNameSnapshot: variant.product.name,
        variantNameSnapshot: variant.name,
        quantity: itemQuantity,
        weightGrams,
        unitPriceMinor,
        lineTotalMinor,
        customizationSnapshotJson:
          verifiedCustomizations.length > 0
            ? JSON.stringify(verifiedCustomizations)
            : null,
      });
    }

    // 2. Validate Minimum Meat Rule (No 1kg restriction; 0 default)
    const rawMeatSetting = settingsMap.get("MIN_QUALIFYING_MEAT_GRAMS") ?? settingsMap.get("minimum_order_meat_grams");
    const minMeatThreshold = rawMeatSetting ? parseInt(rawMeatSetting, 10) : 0;
    const meatValidation = validateMinimumMeatOrder(qualifyingMeatItems, minMeatThreshold);
    if (!meatValidation.isValid) {
      return NextResponse.json(
        { error: meatValidation.message || "Minimum meat requirement not met." },
        { status: 400 }
      );
    }

    // 3. Calculate distance and delivery fee
    const rawShopLat = settingsMap.get("SHOP_LAT");
    const rawShopLng = settingsMap.get("SHOP_LNG");
    const shopCoords = {
      lat: rawShopLat ? parseFloat(rawShopLat) : DEFAULT_SHOP_COORDINATES.lat,
      lng: rawShopLng ? parseFloat(rawShopLng) : DEFAULT_SHOP_COORDINATES.lng,
    };

    const deliveryDistanceMeters = calculateDistanceMeters(
      shopCoords.lat,
      shopCoords.lng,
      destLat,
      destLng
    );

    const deliveryFeeMinor = calculateDeliveryFeePaise(deliveryDistanceMeters);

    // 4. Validate Coupon (Strictly Admin-Controlled: reject inactive, missing, or expired coupons)
    let discountMinor = 0;
    let validCouponId: string | null = null;
    let couponCodeSnapshot: string | null = null;

    if (couponCode && typeof couponCode === "string" && couponCode.trim() !== "") {
      const normalizedCode = couponCode.trim().toUpperCase();
      const coupon = await prisma.coupon.findUnique({
        where: { code: normalizedCode },
      });

      if (!coupon || !coupon.isActive) {
        return NextResponse.json(
          { error: `Coupon "${normalizedCode}" is invalid or has not been activated by the administrator.` },
          { status: 400 }
        );
      }

      const [userUsageCount, totalUsageCount] = await Promise.all([
        prisma.couponRedemption.count({
          where: { couponId: coupon.id, userId: session.id },
        }),
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
        return NextResponse.json(
          { error: evaluation.message || `Coupon "${normalizedCode}" cannot be applied to this order.` },
          { status: 400 }
        );
      }

      discountMinor = evaluation.discountMinor;
      validCouponId = coupon.id;
      couponCodeSnapshot = coupon.code;
    }

    // 5. COD Surcharge
    const codFeeMinor = paymentMethod === "COD" ? COD_SURCHARGE_PAISE : 0;

    // 6. Final Total
    const totalMinor = Math.max(0, subtotalMinor - discountMinor + deliveryFeeMinor + codFeeMinor);

    // 7 & 8. Create Order in atomic database transaction with collision-proof orderNumber retry for heavy concurrent traffic
    let newOrder: any = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        newOrder = await prisma.$transaction(async (tx) => {
          const count = await tx.order.count();
          const suffix = attempt === 0 ? "" : `-${Math.floor(100 + Math.random() * 900)}`;
          const orderNumber = `FC-${1000 + count + 1 + attempt}${suffix}`;

          const order = await tx.order.create({
            data: {
              orderNumber,
              userId: session.id,
              status: "PLACED",
              subtotalMinor,
              discountMinor,
              deliveryFeeMinor,
              codFeeMinor,
              totalMinor,
              deliveryDistanceMeters,
              deliveryLatitude: destLat,
              deliveryLongitude: destLng,
              deliveryAddressSnapshot: JSON.stringify(deliveryAddressObj),
              couponId: validCouponId,
              couponCodeSnapshot,
              notes: sanitizedNotes,
              items: {
                create: preparedOrderItems,
              },
              payment: {
                create: {
                  method: paymentMethod,
                  status: "PENDING",
                  amountMinor: totalMinor,
                  provider: paymentMethod === "COD" ? "CASH_ON_DELIVERY" : "UPI_DYNAMIC_QR",
                  providerReference: `${paymentMethod}_${orderNumber}_${Date.now()}`,
                },
              },
            },
            include: {
              items: true,
              payment: true,
            },
          });

          if (validCouponId) {
            await tx.couponRedemption.create({
              data: {
                couponId: validCouponId,
                userId: session.id,
                orderId: order.id,
                discountMinor,
              },
            });
          }

          await tx.auditLog.create({
            data: {
              actorUserId: session.id,
              action: "ORDER_CREATED",
              entityType: "ORDER",
              entityId: order.id,
              metadataJson: JSON.stringify({
                orderNumber,
                totalMinor,
                itemCount: items.length,
                paymentMethod,
              }),
            },
          });

          return order;
        });
        break;
      } catch (txErr: any) {
        if (txErr?.code === "P2002" && attempt < 4) {
          continue;
        }
        throw txErr;
      }
    }

    // 9. Dispatch transactional notification
    await notificationProvider.sendTransactional({
      userId: session.id,
      orderNumber: newOrder.orderNumber,
      type: "ORDER_PLACED",
      recipientName: session.name,
      recipientPhone: session.mobile,
      metadata: { totalMinor },
    });

    // 10. Automated sequence-wise delivery partner assignment
    try {
      await autoAssignDeliveryPartner(newOrder.id);
    } catch (assignErr) {
      console.warn("Automated sequence assignment notice:", assignErr);
    }

    return NextResponse.json({
      success: true,
      order: newOrder,
    });
  } catch (error: any) {
    console.error("Order creation error:", error);
    return NextResponse.json(
      { error: "Failed to place order. " + (error?.message || "") },
      { status: 500 }
    );
  }
}
