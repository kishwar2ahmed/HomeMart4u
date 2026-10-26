import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import {
  buildUpiUri,
  generateUpiIntentLinks,
  generateUpiQrDataUrl,
  MERCHANT_UPI_VPA,
  MERCHANT_NAME,
  MOBIKWIK_PAYMENT_LINK,
} from "@/lib/upi";
import { getSessionUser } from "@/lib/auth";
import { checkRateLimit, getClientIp } from "@/lib/rate-limiter";
import { sanitizeText } from "@/lib/security";

export async function POST(req: NextRequest) {
  try {
    // 0. Rate Limit QR & Intent Generation per IP
    const clientIp = getClientIp(req);
    const rateLimit = checkRateLimit(`dynamic_qr:${clientIp}`, {
      maxRequests: 25,
      windowMs: 60 * 1000,
    });
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: "Too many payment initialization requests. Please wait a moment." },
        {
          status: 429,
          headers: { "Retry-After": String(rateLimit.resetSeconds) },
        }
      );
    }

    const session = await getSessionUser(req);
    const body = await req.json();
    const { orderId: rawOrderId, amountRupees, orderNumber: rawOrderNumber } = body || {};

    const orderId = typeof rawOrderId === "string" ? sanitizeText(rawOrderId, 64).trim() : "";
    const bodyOrderNumber =
      typeof rawOrderNumber === "string" ? sanitizeText(rawOrderNumber, 64).trim() : "";

    let targetOrderId = orderId;
    let targetOrderNumber = bodyOrderNumber;
    let targetAmountRupees =
      typeof amountRupees === "number" ? amountRupees : parseFloat(String(amountRupees || "0"));

    // Always look up the order in the database when either orderId or orderNumber is provided
    // so the client can NEVER manipulate the payment amount of an order!
    if (orderId || bodyOrderNumber) {
      const order = await prisma.order.findFirst({
        where: orderId ? { id: orderId } : { orderNumber: bodyOrderNumber },
        include: { payment: true },
      });

      if (!order) {
        return NextResponse.json({ error: "Order not found" }, { status: 404 });
      }

      // Verify user ownership if order belongs to a user
      if (order.userId && (!session || (order.userId !== session.id && session.role !== "ADMIN" && session.role !== "SUPER_ADMIN"))) {
        return NextResponse.json({ error: "Unauthorized access to order" }, { status: 403 });
      }

      if (order.status === "CANCELLED") {
        return NextResponse.json(
          { error: "Cannot initialize payment for a cancelled order." },
          { status: 400 }
        );
      }

      if (order.payment?.status === "COMPLETED") {
        return NextResponse.json(
          { error: "Order has already been paid." },
          { status: 400 }
        );
      }

      targetOrderId = order.id;
      targetOrderNumber = order.orderNumber;
      // Authoritative amount from database (ignores client amountRupees)
      targetAmountRupees = order.totalMinor / 100;
    }

    if (!Number.isFinite(targetAmountRupees) || targetAmountRupees <= 0) {
      return NextResponse.json({ error: "Invalid payment amount" }, { status: 400 });
    }

    const vpa = process.env.UPI_VPA || process.env.NEXT_PUBLIC_UPI_VPA || MERCHANT_UPI_VPA;
    const payeeName = process.env.NEXT_PUBLIC_UPI_MERCHANT_NAME || MERCHANT_NAME;
    const orderNumber = targetOrderNumber || `FC-${Date.now().toString().slice(-4)}`;
    const nonce = crypto.randomBytes(4).toString("hex");
    const cleanOrderAlnum = String(orderNumber).replace(/[^a-zA-Z0-9]/g, "");
    const transactionRef = `TXN${cleanOrderAlnum}${Date.now().toString().slice(-8)}${nonce}`;

    const appOrigin =
      process.env.NEXT_PUBLIC_APP_URL || req.nextUrl?.origin || "http://localhost:3000";
    const callbackUrl = targetOrderId
      ? `${appOrigin}/api/payments/callback?orderId=${encodeURIComponent(targetOrderId)}&orderNumber=${encodeURIComponent(orderNumber)}&tr=${encodeURIComponent(transactionRef)}`
      : undefined;

    const upiDetails = {
      vpa,
      payeeName,
      amountRupees: Number(targetAmountRupees.toFixed(2)),
      orderNumber,
      orderId: targetOrderId || undefined,
      transactionRef,
      note: `Order ${orderNumber}`,
      callbackUrl,
    };

    const upiUri = buildUpiUri(upiDetails);
    const intentLinks = generateUpiIntentLinks(upiDetails);
    const qrDataUrl = await generateUpiQrDataUrl(upiUri);

    // Save qrPayload and reference on order payment if order exists, and stamp active session time
    if (targetOrderId) {
      await prisma.payment.updateMany({
        where: { orderId: targetOrderId, status: { in: ["PENDING", "FAILED"] } },
        data: {
          status: "PENDING",
          qrPayload: upiUri,
          providerReference: transactionRef,
          updatedAt: new Date(),
        },
      });
    }

    return NextResponse.json({
      success: true,
      vpa,
      payeeName,
      mobikwikWebLink: MOBIKWIK_PAYMENT_LINK,
      amountRupees: upiDetails.amountRupees,
      orderNumber,
      transactionRef,
      rawUpiUrl: upiUri,
      qrDataUrl,
      intentLinks: {
        ...intentLinks,
        qrDataUrl,
      },
    });
  } catch (error: any) {
    console.error("Dynamic QR generation error:", error);
    return NextResponse.json(
      { error: "Failed to generate dynamic payment QR" },
      { status: 500 }
    );
  }
}
