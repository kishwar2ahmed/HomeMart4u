/**
 * Coupon calculation and validation module
 * Strictly enforces admin activation (isActive), validity window (startsAt/expiresAt),
 * per-customer redemption limit (perUserLimit), and store-wide usage limit (usageLimit).
 */

export interface CouponData {
  id: string;
  code: string;
  type: string;
  value: number; // In rupees for FIXED, in percent for PERCENTAGE
  minimumOrderMinor?: number | null; // In paise
  maximumDiscountMinor?: number | null; // In paise
  freeDelivery?: boolean;
  startsAt: Date;
  expiresAt: Date;
  isActive: boolean;
  usageLimit?: number | null;
  perUserLimit?: number | null;
}

export interface CouponEvaluation {
  isValid: boolean;
  discountMinor: number;
  isFreeDelivery: boolean;
  message?: string;
}

export function evaluateCoupon(
  coupon: CouponData,
  subtotalMinor: number,
  deliveryFeeMinor: number,
  userUsageCount = 0,
  totalUsageCount = 0
): CouponEvaluation {
  const now = new Date();

  if (!coupon.isActive) {
    return {
      isValid: false,
      discountMinor: 0,
      isFreeDelivery: false,
      message: "This coupon is no longer active or has been disabled by the store administrator.",
    };
  }

  if (now < new Date(coupon.startsAt)) {
    return {
      isValid: false,
      discountMinor: 0,
      isFreeDelivery: false,
      message: "This coupon offer has not started yet.",
    };
  }

  if (now > new Date(coupon.expiresAt)) {
    return {
      isValid: false,
      discountMinor: 0,
      isFreeDelivery: false,
      message: "This coupon has expired.",
    };
  }

  if (coupon.usageLimit && totalUsageCount >= coupon.usageLimit) {
    return {
      isValid: false,
      discountMinor: 0,
      isFreeDelivery: false,
      message: "This coupon has reached its maximum overall usage limit.",
    };
  }

  if (coupon.perUserLimit && userUsageCount >= coupon.perUserLimit) {
    return {
      isValid: false,
      discountMinor: 0,
      isFreeDelivery: false,
      message: "You have reached the per-user usage limit for this coupon.",
    };
  }

  if (coupon.minimumOrderMinor && subtotalMinor < coupon.minimumOrderMinor) {
    const minRs = Math.round(coupon.minimumOrderMinor / 100);
    return {
      isValid: false,
      discountMinor: 0,
      isFreeDelivery: false,
      message: `Minimum order amount of ₹${minRs} is required for this coupon.`,
    };
  }

  let discountMinor = 0;
  const isFreeDelivery = Boolean(coupon.freeDelivery || coupon.type === "FREE_DELIVERY");

  if (isFreeDelivery) {
    discountMinor += deliveryFeeMinor;
  }

  if (coupon.type === "FIXED" || coupon.type === "MIN_ORDER_FIXED") {
    const valuePaise = Math.max(0, Math.round(coupon.value * 100));
    discountMinor += Math.min(valuePaise, subtotalMinor);
  } else if (coupon.type === "PERCENTAGE") {
    const safePercent = Math.min(100, Math.max(0, coupon.value));
    let calc = Math.round((subtotalMinor * safePercent) / 100);
    if (coupon.maximumDiscountMinor && calc > coupon.maximumDiscountMinor) {
      calc = coupon.maximumDiscountMinor;
    }
    discountMinor += Math.min(calc, subtotalMinor);
  }

  return {
    isValid: true,
    discountMinor,
    isFreeDelivery,
    message: "Coupon applied successfully",
  };
}
