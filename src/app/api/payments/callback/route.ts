import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { verifyIndianUpiUtr, MERCHANT_UPI_VPA } from "@/lib/upi";
import { sanitizeText } from "@/lib/security";

async function processUpiCallback(
  req: NextRequest,
  params: Record<string, string | null | undefined>
) {
  const orderId = sanitizeText(params.orderId || "", 64).trim();
  const orderNumber = sanitizeText(params.orderNumber || "", 64).trim();
  const tr = sanitizeText(params.tr || params.txnRef || "", 64).trim();
  const rawStatus = sanitizeText(
    params.Status || params.status || params.result || "",
    32
  )
    .trim()
    .toUpperCase();
  const rawUtr = sanitizeText(
    params.ApprovalRefNo || params.approvalRefNo || params.utr || params.rrn || params.txnId || "",
    64
  ).trim();
  const responseCode = sanitizeText(params.responseCode || "", 16).trim();
  const upiApp = sanitizeText(params.upiApp || "UPI_CALLBACK", 40).trim();

  const origin = process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin;

  if (!orderId && !orderNumber && !tr) {
    return NextResponse.redirect(`${origin}/checkout`);
  }

  const payment = await prisma.payment.findFirst({
    where: {
      OR: [
        orderId ? { orderId } : undefined,
        orderNumber ? { order: { orderNumber } } : undefined,
        tr ? { providerReference: tr } : undefined,
      ].filter(Boolean) as any[],
    },
    include: { order: true },
  });

  if (!payment) {
    return NextResponse.redirect(`${origin}/checkout`);
  }

  // Verify session ownership or matching transaction reference
  const session = await getSessionUser(req);
  const isOwner = Boolean(session && session.id === payment.order.userId);
  const matchesTr = Boolean(tr && payment.providerReference && payment.providerReference === tr);

  if (!isOwner && !matchesTr) {
    return NextResponse.redirect(`${origin}/account/orders/${payment.orderId}`);
  }

  if (payment.status === "COMPLETED") {
    return NextResponse.redirect(
      `${origin}/account/orders/${payment.orderId}?payment=success`
    );
  }

  const isSuccess =
    rawStatus === "SUCCESS" ||
    rawStatus === "COMPLETED" ||
    rawStatus === "SUBMITTED" ||
    responseCode === "00";

  // Extract 12-digit UTR if present in ApprovalRefNo / txnId
  const twelveDigitMatch = rawUtr.match(/\b(\d{12})\b/);
  const candidateUtr = twelveDigitMatch ? twelveDigitMatch[1] : "";

  if (isSuccess && candidateUtr && verifyIndianUpiUtr(candidateUtr).isValid) {
    // Ensure UTR is not already claimed by another order
    const duplicate = await prisma.payment.findFirst({
      where: {
        upiTxnRef: candidateUtr,
        orderId: { not: payment.orderId },
      },
    });

    if (!duplicate) {
      await prisma.$transaction(async (tx) => {
        await tx.bankTransaction.upsert({
          where: { utr: candidateUtr },
          update: {
            status: "CLAIMED",
            claimedOrderId: payment.orderId,
            claimedAt: new Date(),
          },
          create: {
            utr: candidateUtr,
            amountMinor: payment.amountMinor,
            payeeVpa: process.env.UPI_VPA || MERCHANT_UPI_VPA,
            source: "UPI_CALLBACK",
            status: "CLAIMED",
            claimedOrderId: payment.orderId,
            claimedAt: new Date(),
            rawPayload: JSON.stringify(params),
          },
        });

        await tx.payment.update({
          where: { id: payment.id },
          data: {
            status: "COMPLETED",
            upiApp,
            upiTxnRef: candidateUtr,
            providerReference: candidateUtr,
            updatedAt: new Date(),
          },
        });

        if (payment.order.status === "PLACED") {
          await tx.order.update({
            where: { id: payment.orderId },
            data: {
              status: "CONFIRMED",
              confirmedAt: new Date(),
            },
          });
        }
      });

      return NextResponse.redirect(
        `${origin}/account/orders/${payment.orderId}?payment=success`
      );
    }
  }

  return NextResponse.redirect(
    `${origin}/account/orders/${payment.orderId}?payment=pending`
  );
}

export async function GET(req: NextRequest) {
  const searchParams = req.nextUrl.searchParams;
  const params: Record<string, string | null> = {};
  searchParams.forEach((value, key) => {
    params[key] = value;
  });
  return processUpiCallback(req, params);
}

export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get("content-type") || "";
    const params: Record<string, string | null> = {};
    req.nextUrl.searchParams.forEach((value, key) => {
      params[key] = value;
    });

    if (contentType.includes("application/json")) {
      const body = await req.json().catch(() => ({}));
      Object.assign(params, body);
    } else if (contentType.includes("application/x-www-form-urlencoded")) {
      const formData = await req.formData().catch(() => null);
      if (formData) {
        formData.forEach((val, key) => {
          params[key] = String(val);
        });
      }
    }

    return processUpiCallback(req, params);
  } catch {
    const origin = process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin;
    return NextResponse.redirect(`${origin}/checkout`);
  }
}
