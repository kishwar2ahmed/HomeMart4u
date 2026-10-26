import { test, describe } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  buildUpiUri,
  generateUpiIntentLinks,
  verifyIndianUpiUtr,
  MERCHANT_UPI_VPA,
  MOBIKWIK_PAYMENT_LINK,
} from "../upi";
import {
  sanitizeText,
  sanitizeAddress,
  verifyHmacSha256Signature,
  timingSafeCompareStrings,
} from "../security";
import {
  calculateDistanceMeters,
  calculateDeliveryFeePaise,
} from "../delivery";

describe("UPI Dynamic QR & App Intent Generation (9844797374@mbk)", () => {
  test("buildUpiUri generates NPCI-compliant URI for ₹2.00 Matchbox order", () => {
    const uri = buildUpiUri({
      vpa: MERCHANT_UPI_VPA,
      payeeName: "homemart4u",
      amountRupees: 2,
      orderNumber: "FC-2001",
      transactionRef: "TXNFC2001",
    });

    assert.ok(uri.startsWith("upi://pay?"));
    assert.ok(uri.includes("pa=9844797374@mbk"));
    assert.ok(uri.includes("am=2.00"));
    assert.ok(uri.includes("cu=INR"));
    assert.ok(uri.includes("tr=TXNFC2001"));
  });

  test("generateUpiIntentLinks provides app-specific deep links for GPay, PhonePe, Paytm, MobiKwik & BHIM", () => {
    const links = generateUpiIntentLinks({
      vpa: MERCHANT_UPI_VPA,
      payeeName: "homemart4u",
      amountRupees: 280.5,
      orderNumber: "FC-2002",
    });

    assert.ok(links.gpayUrl.startsWith("tez://upi/pay?"));
    assert.ok(links.phonepeUrl.startsWith("phonepe://pay?"));
    assert.ok(links.paytmUrl.startsWith("paytmmp://pay?"));
    assert.ok(links.mobikwikUrl.startsWith("mobikwik://upi/pay?"));
    assert.equal(links.mobikwikWebLink, MOBIKWIK_PAYMENT_LINK);
    assert.ok(links.bhimUrl.startsWith("bhim://pay?"));
    assert.ok(links.genericUrl.includes("am=280.50"));
  });

  test("verifyIndianUpiUtr accepts authentic 12-digit UTRs and blocks dummy/sequential/low-entropy strings", () => {
    assert.equal(verifyIndianUpiUtr("412893746512").isValid, true);
    assert.equal(verifyIndianUpiUtr("629584710394").isValid, true);

    // Reject invalid length or non-digits
    assert.equal(verifyIndianUpiUtr("12345").isValid, false);
    assert.equal(verifyIndianUpiUtr("41289374651A").isValid, false);

    // Reject all-same digits
    assert.equal(verifyIndianUpiUtr("111111111111").isValid, false);
    assert.equal(verifyIndianUpiUtr("000000000000").isValid, false);

    // Reject sequential and cyclic patterns
    assert.equal(verifyIndianUpiUtr("123456789012").isValid, false);
    assert.equal(verifyIndianUpiUtr("987654321098").isValid, false);
    assert.equal(verifyIndianUpiUtr("121212121212").isValid, false);
    assert.equal(verifyIndianUpiUtr("123456654321").isValid, false);
  });
});

describe("Security, Sanitization & Delivery Integrity", () => {
  test("sanitizeText strips XSS vectors and script schemes", () => {
    const dirty = `<script>evil(1)</script>javascript:evil() Hello Mulbagal`;
    const clean = sanitizeText(dirty);
    assert.ok(!clean.includes("<script>"));
    assert.ok(!clean.includes("javascript:"));
    assert.ok(clean.includes("Hello Mulbagal"));
  });

  test("sanitizeAddress clamps invalid/NaN coordinates to safe Mulbagal defaults", () => {
    const sanitized = sanitizeAddress({
      label: "Home",
      addressLine: "Main Bazaar",
      latitude: NaN,
      longitude: 999,
    });
    assert.ok(sanitized);
    assert.equal(sanitized.latitude, 13.1645);
    assert.equal(sanitized.longitude, 78.3952);
  });

  test("verifyHmacSha256Signature & timingSafeCompareStrings validate cryptographically", () => {
    const secret = "test_webhook_secret_key";
    const payload = JSON.stringify({ orderId: "123", amountMinor: 200 });
    const validSig = crypto.createHmac("sha256", secret).update(payload).digest("hex");

    assert.equal(verifyHmacSha256Signature(payload, validSig, secret), true);
    assert.equal(verifyHmacSha256Signature(payload, "deadbeef", secret), false);
    assert.equal(timingSafeCompareStrings("abc123xyz", "abc123xyz"), true);
    assert.equal(timingSafeCompareStrings("abc123xyz", "abc123xy0"), false);
  });

  test("calculateDeliveryFeePaise handles free 3km zone and NaN safely", () => {
    assert.equal(calculateDeliveryFeePaise(1500), 0);
    assert.equal(calculateDeliveryFeePaise(3000), 0);
    assert.equal(calculateDeliveryFeePaise(3200), 300); // 200m beyond 3km = ₹3.00 (300 paise)
    assert.equal(calculateDeliveryFeePaise(NaN), 0);
    assert.equal(calculateDistanceMeters(NaN, 78.39, 13.16, 78.39), 0);
  });
});
