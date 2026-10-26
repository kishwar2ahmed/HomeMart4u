import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { checkRateLimit, getClientIp } from "@/lib/rate-limiter";
import { sanitizeText, isValidIndianMobile } from "@/lib/security";
import { notificationProvider } from "@/lib/adapters/NotificationProvider";

export async function POST(req: NextRequest) {
  try {
    const ip = getClientIp(req);
    const rateLimit = checkRateLimit(`contact:${ip}`, {
      windowMs: 10 * 60 * 1000,
      maxRequests: 8,
    });

    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: "Too many inquiries submitted. Please try again in a few minutes." },
        { status: 429 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const name = sanitizeText(body.name, 80);
    const rawMobile = String(body.mobile || "").replace(/\D/g, "").slice(-10);
    const message = sanitizeText(body.message, 1000);

    if (!name || name.length < 2) {
      return NextResponse.json(
        { error: "Please enter your full name (at least 2 characters)." },
        { status: 400 }
      );
    }

    if (!isValidIndianMobile(rawMobile)) {
      return NextResponse.json(
        { error: "Please enter a valid 10-digit Indian mobile number." },
        { status: 400 }
      );
    }

    if (!message || message.length < 5) {
      return NextResponse.json(
        { error: "Please enter a detailed inquiry or message (at least 5 characters)." },
        { status: 400 }
      );
    }

    const session = await getSessionUser(req).catch(() => null);

    // Record customer inquiry in the database notification broadcast log & system inquiry store
    const broadcastRecord = await prisma.notificationBroadcast.create({
      data: {
        createdByUserId: session?.id || `guest:${rawMobile}`,
        title: `Customer Inquiry: ${name} (${rawMobile})`,
        message,
        targetUrl: "/admin",
        status: "SENT",
      },
    });

    const existingInquiriesSetting = await prisma.systemSetting.findUnique({
      where: { key: "CUSTOMER_CONTACT_INQUIRIES" },
    });

    let inquiries: Array<{
      id: string;
      name: string;
      mobile: string;
      message: string;
      userId: string | null;
      createdAt: string;
    }> = [];

    if (existingInquiriesSetting?.value) {
      try {
        const parsed = JSON.parse(existingInquiriesSetting.value);
        if (Array.isArray(parsed)) inquiries = parsed;
      } catch {
        inquiries = [];
      }
    }

    const inquiryEntry = {
      id: broadcastRecord.id,
      name,
      mobile: rawMobile,
      message,
      userId: session?.id || null,
      createdAt: broadcastRecord.createdAt.toISOString(),
    };

    const updatedInquiries = [inquiryEntry, ...inquiries].slice(0, 100);

    await prisma.systemSetting.upsert({
      where: { key: "CUSTOMER_CONTACT_INQUIRIES" },
      update: {
        value: JSON.stringify(updatedInquiries),
        description: "Customer support inquiries submitted via /contact",
      },
      create: {
        key: "CUSTOMER_CONTACT_INQUIRIES",
        value: JSON.stringify(updatedInquiries),
        description: "Customer support inquiries submitted via /contact",
      },
    });

    await notificationProvider.sendBroadcast({
      title: `Support Inquiry Received (#${broadcastRecord.id.slice(-6).toUpperCase()})`,
      message: `Hi ${name}, thank you for contacting homemart4u Mulbagal. Our team at Srinivaspur Road will reach out shortly.`,
      targetUrl: "/admin",
      subscriberTokens: [rawMobile],
    });

    return NextResponse.json({
      success: true,
      inquiryId: broadcastRecord.id,
      message: "Thank you! Your message has been sent to our customer care team at Srinivaspur Road.",
    });
  } catch (error) {
    console.error("Contact inquiry submission error:", error);
    return NextResponse.json(
      { error: "Unable to submit your inquiry right now. Please try again." },
      { status: 500 }
    );
  }
}
