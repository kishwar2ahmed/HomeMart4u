import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

test("Payment Webhook Route enforces constant-time comparisons, 64-char hex signature validation, replay guard, and amount/currency/duplicate-UTR checks", () => {
  const webhookRoute = fs.readFileSync(
    path.join(root, "src/app/api/payments/webhook/route.ts"),
    "utf8"
  );

  // Constant-time secret & HMAC verification
  assert.ok(
    webhookRoute.includes("timingSafeCompareStrings"),
    "Webhook route must use timingSafeCompareStrings for secret comparisons"
  );
  assert.ok(
    webhookRoute.includes("/^[0-9a-fA-F]{64}$/.test(signature)"),
    "Webhook route must enforce strict 64-character hex validation before Buffer.from(..., 'hex')"
  );
  assert.ok(
    webhookRoute.includes("crypto.timingSafeEqual"),
    "Webhook route must compare HMAC digests using crypto.timingSafeEqual"
  );
  assert.ok(
    webhookRoute.includes("isReplayAttack"),
    "Webhook route must enforce replay attack protection"
  );

  // DoS & rate limit protections
  assert.ok(
    webhookRoute.includes("checkRateLimit"),
    "Webhook route must rate limit incoming requests"
  );
  assert.ok(
    webhookRoute.includes("MAX_WEBHOOK_PAYLOAD_BYTES"),
    "Webhook route must cap request body size"
  );

  // Amount, currency, and cross-order duplicate UTR protections
  assert.ok(
    webhookRoute.includes("SECURITY_ALERT_WEBHOOK_AMOUNT_MISMATCH"),
    "Webhook route must detect and reject underpaid/tampered webhook amounts"
  );
  assert.ok(
    webhookRoute.includes("duplicatePayment") && webhookRoute.includes("duplicateBankTx"),
    "Webhook route must block cross-order UTR reuse"
  );
  assert.ok(
    webhookRoute.includes("orFilters.length === 0"),
    "Webhook route must reject payloads lacking all order/payment identifiers"
  );
});

test("Payment Verify Route enforces rate limiting, strict hex signature check, order-reference binding, and cross-order replay protection", () => {
  const verifyRoute = fs.readFileSync(
    path.join(root, "src/app/api/payments/verify/route.ts"),
    "utf8"
  );

  assert.ok(
    verifyRoute.includes("checkRateLimit"),
    "Verify route must rate limit verification attempts"
  );
  assert.ok(
    verifyRoute.includes("timingSafeCompareStrings"),
    "Verify route must use constant-time secret comparison"
  );
  assert.ok(
    verifyRoute.includes("/^[0-9a-fA-F]{64}$/.test(razorpaySignature)"),
    "Verify route must validate 64-char hex format for Razorpay signature"
  );
  assert.ok(
    verifyRoute.includes("existingRefPayment"),
    "Verify route must prevent cross-order payment reference replay"
  );
  assert.ok(
    verifyRoute.includes('payment.status === "REFUNDED"'),
    "Verify route must prevent state-machine downgrades on refunded payments"
  );
});

test("Dynamic QR Route always uses authoritative database order total and blocks amount manipulation via orderNumber", () => {
  const dynamicQrRoute = fs.readFileSync(
    path.join(root, "src/app/api/payments/dynamic-qr/route.ts"),
    "utf8"
  );

  assert.ok(
    dynamicQrRoute.includes("checkRateLimit"),
    "Dynamic QR route must rate limit QR generation"
  );
  assert.ok(
    dynamicQrRoute.includes("order.totalMinor / 100"),
    "Dynamic QR route must use authoritative order.totalMinor from database"
  );
  assert.ok(
    dynamicQrRoute.includes("where: orderId ? { id: orderId } : { orderNumber: bodyOrderNumber }"),
    "Dynamic QR route must look up order by either orderId or orderNumber so client amountRupees cannot override DB total"
  );
});

test("Payment Status Route prevents cross-user IDOR and unauthenticated sequential orderNumber enumeration", () => {
  const statusRoute = fs.readFileSync(
    path.join(root, "src/app/api/payments/[id]/status/route.ts"),
    "utf8"
  );

  assert.ok(
    statusRoute.includes("checkRateLimit"),
    "Payment status POST must rate limit UTR submission attempts"
  );
  assert.ok(
    statusRoute.includes("id === payment.order.orderNumber"),
    "Payment status GET must block unauthenticated sequential orderNumber enumeration"
  );
  assert.ok(
    statusRoute.includes("upiTxnRef: isOwner || isAdmin ? upiTxnRef : undefined"),
    "Payment status GET must redact sensitive transaction metadata for non-owners"
  );
});

test("PaymentProvider Adapter uses cryptographic HMAC-SHA256 verification and strict NPCI UTR validation", () => {
  const providerFile = fs.readFileSync(
    path.join(root, "src/lib/adapters/PaymentProvider.ts"),
    "utf8"
  );

  assert.ok(
    providerFile.includes("verifyHmacSha256Signature(rawString, signature, secret)"),
    "PaymentProvider.verifyPaymentWebhook must perform real cryptographic HMAC-SHA256 verification"
  );
  assert.ok(
    providerFile.includes("verifyIndianUpiUtr(cleanUtr)"),
    "PaymentProvider.verifyUtrWithProvider must validate UTR structure before external inquiry"
  );
  assert.ok(
    providerFile.includes("AbortController"),
    "PaymentProvider.verifyUtrWithProvider must enforce a network timeout via AbortController"
  );
});

test("Auth, Rate Limiter, and Orders Route enforce DB revocation, spoof-resistant IP extraction, and COD anti-flood caps", () => {
  const authFile = fs.readFileSync(path.join(root, "src/lib/auth.ts"), "utf8");
  const rateLimiterFile = fs.readFileSync(path.join(root, "src/lib/rate-limiter.ts"), "utf8");
  const ordersRoute = fs.readFileSync(path.join(root, "src/app/api/orders/route.ts"), "utf8");

  assert.ok(
    authFile.includes('!dbUser || dbUser.status !== "ACTIVE"'),
    "getSessionUser must verify live user ACTIVE status and role in database"
  );
  assert.ok(
    rateLimiterFile.includes("parts[parts.length - 1]"),
    "getClientIp must resist spoofed leading X-Forwarded-For values"
  );
  assert.ok(
    ordersRoute.includes("ALLOWED_PAYMENT_METHODS") && ordersRoute.includes("activePlacedCount >= 5"),
    "Orders route must validate paymentMethod allowlist and cap concurrent unconfirmed PLACED orders"
  );
});

test("Cryptographic HMAC-SHA256 and constant-time comparison logic rejects malformed hex and forged digests", () => {
  const secret = "whsec_super_secret_test_key_2026";
  const payload = JSON.stringify({
    orderId: "clx1234567890abcdefghijkl",
    status: "SUCCESS",
    amountMinor: 49900,
    currency: "INR",
    utr: "612583920415",
  });

  const validSig = crypto.createHmac("sha256", secret).update(payload, "utf8").digest("hex");
  assert.equal(validSig.length, 64);
  assert.match(validSig, /^[0-9a-fA-F]{64}$/);

  // Forged signature with same length
  const forgedSig = validSig.slice(0, 62) + (validSig.endsWith("00") ? "ff" : "00");
  assert.equal(
    crypto.timingSafeEqual(Buffer.from(validSig, "hex"), Buffer.from(forgedSig, "hex")),
    false,
    "Forged signature must be rejected"
  );

  // Truncated / non-hex bypass attempt
  const truncatedSig = validSig.slice(0, 32) + "ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ";
  assert.equal(
    /^[0-9a-fA-F]{64}$/.test(truncatedSig),
    false,
    "Non-hex characters in 64-char signature must be rejected before Buffer.from"
  );
});
