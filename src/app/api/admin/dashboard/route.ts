import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  try {
    const session = await getSessionUser(req);
    if (!session || (session.role !== "ADMIN" && session.role !== "SUPER_ADMIN")) {
      return NextResponse.json({ error: "Forbidden: Admin access required" }, { status: 403 });
    }

    const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const activeOrderCondition = {
      OR: [
        { payment: { method: "COD" } },
        { payment: { status: "COMPLETED" } },
      ],
    };

    // 1. Orders today (excluding unpaid online checkouts)
    const ordersToday = await prisma.order.findMany({
      where: {
        createdAt: { gte: startOfToday },
        ...activeOrderCondition,
      },
      select: { totalMinor: true, status: true, placedAt: true, id: true, orderNumber: true },
    });

    const todayOrderCount = ordersToday.length;
    const todaySalesMinor = ordersToday
      .filter((o) => o.status !== "CANCELLED")
      .reduce((sum, o) => sum + o.totalMinor, 0);

    const aovMinor = todayOrderCount > 0 ? Math.round(todaySalesMinor / todayOrderCount) : 0;

    // 2. Past 2-day orders and payment breakdown (excluding unpaid online checkouts)
    const past2DaysOrders = await prisma.order.findMany({
      where: {
        createdAt: { gte: twoDaysAgo },
        ...activeOrderCondition,
      },
      include: { payment: true },
    });

    let twoDaysSuccessPayments = 0;
    let twoDaysPendingPayments = 0;
    let twoDaysFailedPayments = 0;

    past2DaysOrders.forEach((o) => {
      const pStatus = o.payment?.status;
      if (pStatus === "COMPLETED") twoDaysSuccessPayments++;
      else if (pStatus === "FAILED") twoDaysFailedPayments++;
      else twoDaysPendingPayments++;
    });

    // 3. Status Breakdown for the past 2 days
    const statusCounts = await prisma.order.groupBy({
      by: ["status"],
      where: {
        createdAt: { gte: twoDaysAgo },
        ...activeOrderCondition,
      },
      _count: { id: true },
    });

    const statusMap: Record<string, number> = {
      PLACED: 0,
      CONFIRMED: 0,
      PREPARING: 0,
      OUT_FOR_DELIVERY: 0,
      DELIVERED: 0,
      CANCELLED: 0,
    };

    statusCounts.forEach((s) => {
      statusMap[s.status] = s._count.id;
    });

    // 4. Operational Alerts
    const unassignedOrders = await prisma.order.findMany({
      where: {
        status: { in: ["CONFIRMED", "PREPARING"] },
        deliveryAssignment: null,
        createdAt: { gte: twoDaysAgo },
        ...activeOrderCondition,
      },
      include: { user: { select: { name: true, mobile: true } } },
      take: 5,
    });

    // Out of stock products
    const outOfStockProducts = await prisma.product.findMany({
      where: { isAvailable: false, isActive: true },
      select: { id: true, name: true, slug: true, category: { select: { name: true } } },
    });

    // Orders approaching 20-minute delivery target
    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
    const targetAtRiskOrders = await prisma.order.findMany({
      where: {
        status: { in: ["PLACED", "CONFIRMED", "PREPARING", "OUT_FOR_DELIVERY"] },
        placedAt: { lte: fifteenMinutesAgo },
        createdAt: { gte: twoDaysAgo },
        ...activeOrderCondition,
      },
      select: { id: true, orderNumber: true, status: true, placedAt: true, totalMinor: true },
      take: 5,
    });

    // Recent orders for dashboard table
    const recentOrders = await prisma.order.findMany({
      where: {
        createdAt: { gte: twoDaysAgo },
        ...activeOrderCondition,
      },
      take: 10,
      orderBy: { createdAt: "desc" },
      include: {
        user: { select: { name: true, mobile: true } },
        items: true,
        payment: true,
        deliveryAssignment: {
          include: { agent: { select: { name: true } } },
        },
      },
    });

    // 5. Real SLA Compliance Rate calculation across delivered orders
    const deliveredOrders = past2DaysOrders.filter(
      (o) => o.status === "DELIVERED" && o.deliveredAt
    );
    const SLA_TARGET_MS = 20 * 60 * 1000; // 20 minutes from confirmation/placement
    let withinSlaCount = 0;
    let totalDeliveryDurationMs = 0;

    deliveredOrders.forEach((o) => {
      const startTimestamp = o.confirmedAt
        ? new Date(o.confirmedAt).getTime()
        : new Date(o.placedAt).getTime();
      const endTimestamp = new Date(o.deliveredAt!).getTime();
      const durationMs = Math.max(0, endTimestamp - startTimestamp);
      totalDeliveryDurationMs += durationMs;
      if (durationMs <= SLA_TARGET_MS) {
        withinSlaCount++;
      }
    });

    const slaComplianceRate =
      deliveredOrders.length > 0
        ? Number(((withinSlaCount / deliveredOrders.length) * 100).toFixed(1))
        : 100;

    const avgDeliveryMinutes =
      deliveredOrders.length > 0
        ? Math.max(1, Math.round(totalDeliveryDurationMs / deliveredOrders.length / 60000))
        : 18;

    return NextResponse.json({
      metrics: {
        todaySalesMinor,
        todayOrderCount,
        aovMinor,
        statusMap,
        past2DaysTotal: past2DaysOrders.length,
        twoDaysSuccessPayments,
        twoDaysPendingPayments,
        twoDaysFailedPayments,
        slaComplianceRate,
        avgDeliveryMinutes,
        deliveredCount: deliveredOrders.length,
      },
      alerts: {
        unassignedOrders,
        outOfStockProducts,
        targetAtRiskOrders,
      },
      recentOrders,
    });
  } catch (error) {
    console.error("Dashboard data error:", error);
    return NextResponse.json({ error: "Failed to load dashboard data" }, { status: 500 });
  }
}
