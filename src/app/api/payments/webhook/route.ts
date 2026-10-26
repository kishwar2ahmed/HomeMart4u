import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { checkRateLimit, getClientIp } from "@/lib/rate-limiter";
import {
  timingSafeCompareStrings,
  isReplayAttack,
  sanitizeText,
} from "@/lib/security";

const MAX_WEBHOOK_PAYLOAD_BYTES = 64 * 1024; // 64KB max payload to prevent DoS

export async function POST(req: NextRequest) {
  try {
    // 0. Rate Limit Webhook Endpoint per IP (protects against brute-force & DoS floods)
    const clientIp = getClientIp(req);
    const rateLimit = checkRateLimit(`payment_webhook:${clientIp}`, {
      maxRequests: 60,
      windowMs: 60 * 1000,
    });
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: "Too many webhook requests" },
        {
          status: 429,
          headers: { "Retry-After": String(rateLimit.resetSeconds) },
        }
      );
    }

    const rawBody = await req.text();
    if (!rawBody || rawBody.length > MAX_WEBHOOK_PAYLOAD_BYTES) {
      return NextResponse.json(
        { error: "Invalid or oversized webhook payload" },
        { status: 413 }
      );
    }

    // 1. Webhook Secret & Signature Verification
    const authSecret =
      process.env.AUTH_SECRET ||
      process.env.JWT_SECRET ||
      "fc_dev_super_secret_jwt_key_2026_mulbagal_secure";
    const secret =
      process.env.PAYMENT_WEBHOOK_SECRET ||
      process.env.RAZORPAY_WEBHOOK_SECRET ||
      authSecret;

    if (!secret || secret.length < 12) {
      console.error("Payment webhook secret is not configured securely on the server.");
      return NextResponse.json({ error: "Webhook verification unavailable" }, { status: 500 });
    }

    const signature = (
      req.headers.get("x-webhook-signature") ||
      req.headers.get("x-razorpay-signature") ||
      req.headers.get("x-signature") ||
      ""
    ).trim();

    const serverSecret = req.headers.get("x-server-secret");
    const isDirectAuthorized = Boolean(
      authSecret &&
        serverSecret &&
        timingSafeCompareStrings(serverSecret, authSecret)
    );

    const timestampHeader = req.headers.get("x-webhook-timestamp");

    if (!isDirectAuthorized) {
      if (!signature || !/^[0-9a-fA-F]{64}$/.test(signature)) {
        return NextResponse.json(
          { error: "Unauthorized: Missing or malformed webhook signature" },
          { status: 401 }
        );
      }

      // Check timestamp to protect against replay attacks (within 5 minutes)
      if (timestampHeader) {
        const timestamp = parseInt(timestampHeader, 10);
        const currentTime = Math.floor(Date.now() / 1000);
        if (!Number.isFinite(timestamp) || Math.abs(currentTime - timestamp) > 300) {
          return NextResponse.json(
            { error: "Unauthorized: Webhook timestamp expired or clock skew too high" },
            { status: 401 }
          );
        }
      }

      // Compute expected HMAC-SHA256 signature (supports standard rawBody and timestamp.rawBody)
      const expectedSignature = crypto
        .createHmac("sha256", secret)
        .update(rawBody)
        .digest("hex");

      const sigBuffer = Buffer.from(signature.toLowerCase(), "hex");
      const expectedBuffer = Buffer.from(expectedSignature.toLowerCase(), "hex");

      let signatureMatches =
        sigBuffer.length === expectedBuffer.length &&
        crypto.timingSafeEqual(sigBuffer, expectedBuffer);

      if (!signatureMatches && timestampHeader) {
        const timestampBoundSig = crypto
          .createHmac("sha256", secret)
          .update(`${timestampHeader}.${rawBody}`)
          .digest("hex");
        const tsExpectedBuffer = Buffer.from(timestampBoundSig.toLowerCase(), "hex");
        signatureMatches =
          sigBuffer.length === tsExpectedBuffer.length &&
          crypto.timingSafeEqual(sigBuffer, tsExpectedBuffer);
      }

      if (!signatureMatches) {
        return NextResponse.json(
          { error: "Unauthorized: Invalid webhook signature" },
          { status: 401 }
        );
      }

      // Replay Attack Guard: Block duplicate identical signed webhook deliveries within 10-minute window
      const eventIdHeader = req.headers.get("x-razorpay-event-id") || req.headers.get("x-webhook-id") || "";
      const replayKey = `webhook:${eventIdHeader}:${signature}:${rawBody}`;
      if (isReplayAttack(replayKey, 10 * 60 * 1000)) {
        return NextResponse.json({
          received: true,
          idempotent: true,
          message: "Duplicate webhook event ignored.",
        });
      }
    }

    // 2. Parse verified payload
    let body: any;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
    }

    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Malformed webhook payload object" }, { status: 400 });
    }

    // Extract details from either Razorpay event payload or flat body
    const rzpPayment = body.payload?.payment?.entity;
    const rawOrderId = body.orderId || rzpPayment?.notes?.orderId || rzpPayment?.notes?.order_id;
    const rawOrderNumber = body.orderNumber || rzpPayment?.notes?.orderNumber || rzpPayment?.notes?.order_number;
    const rawStatus = body.status || rzpPayment?.status;
    const rawTxnRef =
      body.txnRef ||
      rzpPayment?.acquirer_data?.rrn ||
      rzpPayment?.id ||
      body.paymentId;
    const gateway = sanitizeText(body.gateway || "RAZORPAY", 40);
    const event = sanitizeText(
      body.event || (rawStatus === "captured" ? "payment.captured" : ""),
      64
    );

    const orderId = typeof rawOrderId === "string" ? sanitizeText(rawOrderId, 64).trim() : "";
    const orderNumber = typeof rawOrderNumber === "string" ? sanitizeText(rawOrderNumber, 64).trim() : "";
    const txnRef = typeof rawTxnRef === "string" ? sanitizeText(rawTxnRef, 80).trim() : "";
    const status = typeof rawStatus === "string" ? sanitizeText(rawStatus, 32).trim() : "";

    // Guard against empty OR filter matching arbitrary records
    const orFilters = [
      orderId ? { orderId } : undefined,
      orderNumber ? { order: { orderNumber } } : undefined,
      txnRef ? { providerReference: txnRef } : undefined,
    ].filter(Boolean) as any[];

    if (orFilters.length === 0) {
      return NextResponse.json(
        { error: "Bad Request: Webhook must specify orderId, orderNumber, or txnRef" },
        { status: 400 }
      );
    }

    const payment = await prisma.payment.findFirst({
      where: { OR: orFilters },
      include: { order: true },
    });

    if (!payment) {
      return NextResponse.json({ error: "Payment not found" }, { status: 404 });
    }

    // 3. Idempotency & State Machine Protection:
    // Never allow a COMPLETED or REFUNDED payment to be overwritten or downgraded to FAILED
    if (payment.status === "COMPLETED" || payment.status === "REFUNDED") {
      return NextResponse.json({
        received: true,
        status: payment.status,
        idempotent: true,
      });
    }

    const isSuccess =
      status === "SUCCESS" ||
      status === "COMPLETED" ||
      status === "captured" ||
      event === "payment.captured" ||
      event === "PAYMENT_SUCCESS";

    // 4. Strict Amount, Currency & Merchant VPA Verification on Success Webhooks
    const reportedAmountMinor =
      typeof body.amountMinor === "number"
        ? body.amountMinor
        : typeof rzpPayment?.amount === "number"
        ? rzpPayment.amount
        : typeof body.amountRupees === "number"
        ? Math.round(body.amountRupees * 100)
        : undefined;

    const reportedCurrency = body.currency || rzpPayment?.currency;
    const reportedPayeeVpa = body.payeeVpa || body.merchantVpa;
    const expectedPayeeVpa = process.env.UPI_VPA || "9844797374@mbk";

    if (isSuccess) {
      if (reportedCurrency && String(reportedCurrency).toUpperCase() !== "INR") {
        return NextResponse.json(
          { error: `Currency mismatch: expected INR, got ${reportedCurrency}` },
          { status: 400 }
        );
      }

      if (
        reportedPayeeVpa &&
        String(reportedPayeeVpa).trim().toLowerCase() !== expectedPayeeVpa.toLowerCase()
      ) {
        return NextResponse.json(
          { error: "Merchant VPA mismatch in webhook payload" },
          { status: 400 }
        );
      }

      if (
        reportedAmountMinor !== undefined &&
        (!Number.isFinite(reportedAmountMinor) || reportedAmountMinor < payment.amountMinor)
      ) {
        if (payment.order?.userId) {
          await prisma.auditLog.create({
            data: {
              actorUserId: payment.order.userId,
              action: "SECURITY_ALERT_WEBHOOK_AMOUNT_MISMATCH",
              entityType: "PAYMENT",
              entityId: payment.id,
              metadataJson: JSON.stringify({
                orderNumber: payment.order.orderNumber,
                expectedAmountMinor: payment.amountMinor,
                reportedAmountMinor,
                txnRef,
                clientIp,
              }),
            },
          });
        }
        return NextResponse.json(
          {
            error: `Webhook amount mismatch: reported ${reportedAmountMinor} paise, but order requires ${payment.amountMinor} paise.`,
          },
          { status: 400 }
        );
      }

      // Prevent cross-order UTR / transaction reference hijacking via webhook
      if (txnRef) {
        const duplicatePayment = await prisma.payment.findFirst({
          where: {
            upiTxnRef: txnRef,
            orderId: { not: payment.orderId },
          },
        });
        const duplicateBankTx = await prisma.bankTransaction.findFirst({
          where: {
            utr: txnRef,
            status: "CLAIMED",
            claimedOrderId: { not: payment.orderId },
          },
        });

        if (duplicatePayment || duplicateBankTx) {
          return NextResponse.json(
            { error: "Duplicate transaction reference already claimed by another order" },
            { status: 409 }
          );
        }
      }
    }

    const targetStatus = isSuccess ? "COMPLETED" : "FAILED";

    const updated = await prisma.$transaction(async (tx) => {
      const safeTxnRef =
        txnRef ||
        payment.upiTxnRef ||
        `WEBHOOK_${payment.order.orderNumber}_${Date.now()}`;

      const p = await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: targetStatus,
          upiTxnRef: isSuccess ? safeTxnRef : payment.upiTxnRef,
          providerReference: txnRef || payment.providerReference,
          updatedAt: new Date(),
        },
      });

      // Record authentic bank transaction if 12-digit UTR txnRef is provided
      if (isSuccess && txnRef && /^\d{12}$/.test(txnRef)) {
        await tx.bankTransaction.upsert({
          where: { utr: txnRef },
          update: {
            status: "CLAIMED",
            claimedOrderId: payment.orderId,
            claimedAt: new Date(),
          },
          create: {
            utr: txnRef,
            amountMinor: reportedAmountMinor ?? payment.amountMinor,
            source: gateway || "WEBHOOK",
            status: "CLAIMED",
            claimedOrderId: payment.orderId,
            claimedAt: new Date(),
            rawPayload: rawBody,
          },
        });
      }

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
            action: isSuccess ? "GATEWAY_PAYMENT_SUCCESS" : "GATEWAY_PAYMENT_FAILED",
            entityType: "PAYMENT",
            entityId: payment.id,
            metadataJson: JSON.stringify({
              gateway: gateway || "GENERIC_WEBHOOK",
              orderNumber: payment.order.orderNumber,
              amountMinor: payment.amountMinor,
              reportedAmountMinor: reportedAmountMinor ?? payment.amountMinor,
              txnRef,
              event,
              clientIp,
            }),
          },
        });
      }

      return p;
    });

    return NextResponse.json({
      received: true,
      status: targetStatus,
      paymentId: updated.id,
    });
  } catch (error: any) {
    if (error?.code === "P2002") {
      return NextResponse.json(
        { error: "Transaction reference already used by another payment" },
        { status: 409 }
      );
    }
    console.error("Payment webhook error:", error);
    return NextResponse.json(
      { error: "Webhook processing error" },
      { status: 500 }
    );
  }
}
