import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { checkRateLimit, getClientIp } from "@/lib/rate-limiter";
import { timingSafeCompareStrings, sanitizeText } from "@/lib/security";

export async function POST(req: NextRequest) {
  try {
    // 0. Rate Limit Payment Verification Endpoint
    const clientIp = getClientIp(req);
    const rateLimit = checkRateLimit(`payment_verify:${clientIp}`, {
      maxRequests: 15,
      windowMs: 60 * 1000,
    });
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: "Too many verification attempts. Please wait before retrying." },
        {
          status: 429,
          headers: { "Retry-After": String(rateLimit.resetSeconds) },
        }
      );
    }

    const session = await getSessionUser(req);
    const authSecret =
      process.env.AUTH_SECRET ||
      process.env.JWT_SECRET ||
      "fc_dev_super_secret_jwt_key_2026_mulbagal_secure";
    const authHeader = req.headers.get("x-server-secret");
    const isServerAuthorized = Boolean(
      authSecret &&
        authHeader &&
        timingSafeCompareStrings(authHeader, authSecret)
    );
    const isAdmin = Boolean(
      session && (session.role === "ADMIN" || session.role === "SUPER_ADMIN")
    );

    const body = await req.json();
    const {
      orderId: rawOrderId,
      orderNumber: rawOrderNumber,
      razorpayPaymentId: rawRzpPaymentId,
      razorpayOrderId: rawRzpOrderId,
      razorpaySignature: rawRzpSignature,
      upiTxnRef: rawUpiTxnRef,
      upiApp: rawUpiApp,
      method: rawMethod = "RAZORPAY",
      isSuccess = true,
      failureReason: rawFailureReason,
      amountMinor: reportedAmountMinor,
    } = body || {};

    const orderId = typeof rawOrderId === "string" ? sanitizeText(rawOrderId, 64).trim() : "";
    const orderNumber = typeof rawOrderNumber === "string" ? sanitizeText(rawOrderNumber, 64).trim() : "";
    const razorpayPaymentId = typeof rawRzpPaymentId === "string" ? sanitizeText(rawRzpPaymentId, 80).trim() : "";
    const razorpayOrderId = typeof rawRzpOrderId === "string" ? sanitizeText(rawRzpOrderId, 80).trim() : "";
    const razorpaySignature = typeof rawRzpSignature === "string" ? rawRzpSignature.trim() : "";
    const upiTxnRef = typeof rawUpiTxnRef === "string" ? sanitizeText(rawUpiTxnRef, 80).trim() : "";
    const upiApp = typeof rawUpiApp === "string" ? sanitizeText(rawUpiApp, 40).trim() : "";
    const method = typeof rawMethod === "string" ? sanitizeText(rawMethod, 32).trim() : "RAZORPAY";
    const failureReason = typeof rawFailureReason === "string" ? sanitizeText(rawFailureReason, 250) : undefined;

    const orFilters = [
      orderId ? { orderId } : undefined,
      orderNumber ? { order: { orderNumber } } : undefined,
    ].filter(Boolean) as any[];

    if (orFilters.length === 0) {
      return NextResponse.json(
        { error: "Order ID or Order Number is required" },
        { status: 400 }
      );
    }

    const payment = await prisma.payment.findFirst({
      where: { OR: orFilters },
      include: { order: true },
    });

    if (!payment) {
      return NextResponse.json({ error: "Order payment record not found" }, { status: 404 });
    }

    // Verify ownership: Admin, Server Secret, or Order Owner
    const isOwner = Boolean(session && session.id === payment.order.userId);

    if (!isAdmin && !isServerAuthorized && !isOwner) {
      return NextResponse.json({ error: "Unauthorized access to order payment" }, { status: 403 });
    }

    // State Machine Guard: Prevent tampering with already completed/refunded payments or cancelled orders
    if (payment.status === "COMPLETED" || payment.status === "REFUNDED") {
      return NextResponse.json({
        success: true,
        idempotent: true,
        status: payment.status,
        paymentId: payment.providerReference || payment.upiTxnRef,
        orderNumber: payment.order.orderNumber,
        orderId: payment.orderId,
        amountRupees: payment.amountMinor / 100,
        payment,
      });
    }

    if (payment.order.status === "CANCELLED") {
      return NextResponse.json(
        { error: "Cannot verify payment for a cancelled order." },
        { status: 400 }
      );
    }

    // Amount Tampering Guard
    if (
      isSuccess &&
      reportedAmountMinor !== undefined &&
      (!Number.isFinite(reportedAmountMinor) || reportedAmountMinor < payment.amountMinor)
    ) {
      return NextResponse.json(
        { error: "Payment amount mismatch: verified amount is less than order total." },
        { status: 400 }
      );
    }

    // Cryptographic validation for payment confirmation
    if (isSuccess && !isAdmin && !isServerAuthorized) {
      const secret =
        process.env.RAZORPAY_KEY_SECRET ||
        process.env.PAYMENT_WEBHOOK_SECRET ||
        authSecret;

      if (
        !secret ||
        !razorpayOrderId ||
        !razorpayPaymentId ||
        !razorpaySignature ||
        !/^[0-9a-fA-F]{64}$/.test(razorpaySignature)
      ) {
        return NextResponse.json(
          {
            error:
              "Unauthorized: Valid cryptographic payment signature is required to confirm online payment.",
          },
          { status: 401 }
        );
      }

      // If payment record already has a gateway order reference (order_...), ensure razorpayOrderId matches it
      if (
        payment.providerReference &&
        payment.providerReference.startsWith("order_") &&
        payment.providerReference !== razorpayOrderId
      ) {
        return NextResponse.json(
          { error: "Unauthorized: Gateway order reference does not match this order." },
          { status: 401 }
        );
      }

      const expectedSignature = crypto
        .createHmac("sha256", secret)
        .update(`${razorpayOrderId}|${razorpayPaymentId}`)
        .digest("hex");

      const sigBuf = Buffer.from(razorpaySignature.toLowerCase(), "hex");
      const expBuf = Buffer.from(expectedSignature.toLowerCase(), "hex");
      if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
        return NextResponse.json(
          { error: "Unauthorized: Invalid cryptographic payment signature" },
          { status: 401 }
        );
      }
    }

    // Cross-Order Replay Guard: Ensure payment reference has not been claimed by any other order
    const candidateRef = razorpayPaymentId || upiTxnRef;
    if (isSuccess && candidateRef) {
      const existingRefPayment = await prisma.payment.findFirst({
        where: {
          OR: [{ upiTxnRef: candidateRef }, { providerReference: candidateRef }],
          orderId: { not: payment.orderId },
        },
      });
      if (existingRefPayment) {
        return NextResponse.json(
          { error: "Security Alert: This payment reference has already been used for another order." },
          { status: 409 }
        );
      }
    }

    const nonce = crypto.randomBytes(4).toString("hex");
    const txnRef = candidateRef || `pay_${Date.now().toString(36)}_${nonce}`;
    const newStatus = isSuccess ? "COMPLETED" : "FAILED";

    const updated = await prisma.$transaction(async (tx) => {
      const p = await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: newStatus,
          method: method || payment.method,
          provider: "RAZORPAY",
          providerReference: txnRef,
          upiTxnRef: isSuccess ? txnRef : payment.upiTxnRef,
          upiApp: upiApp || payment.upiApp || "RAZORPAY_GATEWAY",
          updatedAt: new Date(),
        },
      });

      if (isSuccess && payment.order.status === "PLACED") {
        await tx.order.update({
          where: { id: payment.orderId },
          data: {
            status: "CONFIRMED",
            confirmedAt: new Date(),
          },
        });
      }

      if (payment.order?.userId) {
        await tx.auditLog.create({
          data: {
            actorUserId: payment.order.userId,
            action: isSuccess ? "RAZORPAY_PAYMENT_VERIFIED" : "RAZORPAY_PAYMENT_FAILED",
            entityType: "PAYMENT",
            entityId: payment.id,
            metadataJson: JSON.stringify({
              orderNumber: payment.order.orderNumber,
              amountMinor: payment.amountMinor,
              razorpayPaymentId: txnRef,
              razorpayOrderId,
              razorpaySignature: razorpaySignature ? "verified_hmac" : "admin_or_server",
              method,
              clientIp,
              failureReason: !isSuccess ? failureReason : undefined,
              verifiedAt: new Date().toISOString(),
            }),
          },
        });
      }

      return p;
    });

    return NextResponse.json({
      success: true,
      status: newStatus,
      paymentId: txnRef,
      orderNumber: payment.order.orderNumber,
      orderId: payment.orderId,
      amountRupees: payment.amountMinor / 100,
      payment: updated,
    });
  } catch (error: any) {
    if (error?.code === "P2002") {
      return NextResponse.json(
        { error: "This payment reference has already been claimed by another order." },
        { status: 409 }
      );
    }
    console.error("Payment verification error:", error);
    return NextResponse.json({ error: "Verification failed" }, { status: 500 });
  }
}
