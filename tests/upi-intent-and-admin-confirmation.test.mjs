import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { buildUpiUri, generateUpiIntentLinks } from "../src/lib/upi.ts";

describe("Dynamic UPI QR (Exact Bill Amount), Multi-App UPI Selector, Auto-Redirect & Admin Confirmation Timer", () => {
  const rootDir = process.cwd();

  it("buildUpiUri and generateUpiIntentLinks must encode exact bill amount, literal @ in 9844797374@mbk, and MobiKwik link", () => {
    const details = {
      vpa: "9844797374@mbk",
      payeeName: "homemart4u",
      amountRupees: 345.5,
      orderNumber: "FC-1025",
      transactionRef: "TXNFC1025998877",
      callbackUrl: "http://localhost:3000/api/payments/callback?orderId=ord_123",
    };

    const uri = buildUpiUri(details);
    assert.ok(uri.startsWith("upi://pay?"), "Must start with upi://pay?");
    assert.ok(uri.includes("pa=9844797374@mbk"), "Must preserve literal @ in merchant VPA 9844797374@mbk");
    assert.ok(uri.includes("am=345.50"), "Must encode exact 2-decimal bill amount am=345.50");
    assert.ok(uri.includes("cu=INR"), "Must specify INR currency");

    const links = generateUpiIntentLinks(details);
    assert.ok(links.gpayUrl.includes("pa=9844797374@mbk") && links.gpayUrl.includes("am=345.50"));
    assert.ok(links.phonepeUrl.includes("pa=9844797374@mbk") && links.phonepeUrl.includes("am=345.50"));
    assert.ok(links.paytmUrl.includes("pa=9844797374@mbk") && links.paytmUrl.includes("am=345.50"));
    assert.ok(links.mobikwikUrl.includes("pa=9844797374@mbk") && links.mobikwikUrl.includes("am=345.50"));
    assert.equal(links.mobikwikWebLink, "https://w6em.app.link/wJYGFGk8v7b");
  });

  it("DynamicPaymentModal must render Dynamic QR for exact bill amount and offer all UPI Intent Apps", () => {
    const modalPath = path.join(rootDir, "src", "components", "payment", "DynamicPaymentModal.tsx");
    assert.ok(fs.existsSync(modalPath), "DynamicPaymentModal must exist");
    const content = fs.readFileSync(modalPath, "utf-8");

    // Must render Dynamic QR Code for exact bill amount
    assert.ok(content.includes("alt=\"Dynamic UPI QR Code\""), "Must render Dynamic UPI QR Code image in modal");
    assert.ok(content.includes("qrDataUrl"), "Must bind qrDataUrl state and rendering in modal");
    assert.ok(content.includes("9844797374@mbk"), "Must display merchant VPA 9844797374@mbk");
    assert.ok(content.includes("https://w6em.app.link/wJYGFGk8v7b"), "Must integrate official MobiKwik payment link");

    // Must offer Google Pay, PhonePe, Paytm, MobiKwik, and BHIM / Any UPI App intent launches
    assert.ok(content.includes("Google Pay"), "Must include Google Pay app intent");
    assert.ok(content.includes("PhonePe"), "Must include PhonePe app intent");
    assert.ok(content.includes("Paytm"), "Must include Paytm app intent");
    assert.ok(content.includes("MobiKwik"), "Must include MobiKwik app intent");
    assert.ok(content.includes("gpayUrl"), "Must bind gpayUrl intent");
    assert.ok(content.includes("phonepeUrl"), "Must bind phonepeUrl intent");
    assert.ok(content.includes("mobikwikUrl"), "Must bind mobikwikUrl intent");
  });

  it("DynamicPaymentModal and CheckoutPage must automatically detect payment completion and redirect to order page without cart redirect hijacking", () => {
    const modalPath = path.join(rootDir, "src", "components", "payment", "DynamicPaymentModal.tsx");
    const content = fs.readFileSync(modalPath, "utf-8");
    assert.ok(content.includes("api/payments/${orderId}/status"), "Must poll payment status endpoint");
    assert.ok(content.includes("visibilitychange"), "Must detect when user returns from UPI app");
    assert.ok(content.includes("COMPLETED"), "Must check for COMPLETED status automatically");
    assert.ok(content.includes("FAILED"), "Must check for FAILED status automatically");

    const checkoutPath = path.join(rootDir, "src", "app", "checkout", "page.tsx");
    const checkoutContent = fs.readFileSync(checkoutPath, "utf-8");
    assert.ok(
      checkoutContent.includes("isOrderCompletedRef"),
      "CheckoutPage must guard against empty-cart redirect hijacking when order completes"
    );

    const ordersApiPath = path.join(rootDir, "src", "app", "api", "orders", "route.ts");
    const ordersApiContent = fs.readFileSync(ordersApiPath, "utf-8");
    assert.ok(
      ordersApiContent.includes('"ONLINE"') && ordersApiContent.includes('"MOBIKWIK"'),
      "POST /api/orders must allow ONLINE and MOBIKWIK payment methods"
    );
  });

  it("DynamicPaymentModal must render a custom Success screen and a custom Failure screen", () => {
    const modalPath = path.join(rootDir, "src", "components", "payment", "DynamicPaymentModal.tsx");
    const content = fs.readFileSync(modalPath, "utf-8");
    assert.ok(content.includes("Payment Confirmed") || content.includes("Paid Successfully"), "Must render custom success screen");
    assert.ok(content.includes("Payment Incomplete") || content.includes("Payment Unsuccessful"), "Must render custom failure screen");
    assert.ok(content.includes("Switch to Cash on Delivery"), "Must render Switch to COD action");
  });

  it("custom error boundary pages error.tsx and global-error.tsx must exist with support contacts", () => {
    const errorPagePath = path.join(rootDir, "src", "app", "error.tsx");
    const globalErrorPath = path.join(rootDir, "src", "app", "global-error.tsx");
    const notFoundPath = path.join(rootDir, "src", "app", "not-found.tsx");

    assert.ok(fs.existsSync(errorPagePath), "src/app/error.tsx must exist");
    assert.ok(fs.existsSync(globalErrorPath), "src/app/global-error.tsx must exist");
    assert.ok(fs.existsSync(notFoundPath), "src/app/not-found.tsx must exist");

    const errorContent = fs.readFileSync(errorPagePath, "utf-8");
    assert.ok(errorContent.includes("reset"), "error.tsx must provide reset/retry callback");
    assert.ok(errorContent.includes("9035526638"), "error.tsx must provide store support hotline");

    const notFoundContent = fs.readFileSync(notFoundPath, "utf-8");
    assert.ok(notFoundContent.includes("404"), "not-found.tsx must display 404");
  });

  it("customer order screen delivery timer must start ONLY after order is confirmed by admin", () => {
    const orderDetailsPath = path.join(rootDir, "src", "app", "account", "orders", "[id]", "page.tsx");
    const content = fs.readFileSync(orderDetailsPath, "utf-8");

    assert.ok(
      content.includes("order.confirmedAt"),
      "Must check for order.confirmedAt before starting countdown timer"
    );
    assert.ok(
      content.includes("Order Received — Awaiting Store Confirmation") || content.includes("Awaiting Store Confirmation"),
      "Must inform user that countdown begins once confirmed by store admin"
    );
    assert.ok(
      content.includes("confirmedTime + 20 * 60 * 1000"),
      "Countdown target delivery time must be calculated from admin confirmation time"
    );
  });

  it("admin orders route must only show orders once paid or if COD", () => {
    const adminOrdersPath = path.join(rootDir, "src", "app", "api", "admin", "orders", "route.ts");
    const content = fs.readFileSync(adminOrdersPath, "utf-8");
    assert.ok(content.includes("payment: { method: \"COD\" }"), "Must show COD orders");
    assert.ok(content.includes("payment: { status: \"COMPLETED\" }"), "Must show completed payments only");
  });

  it("order tracking page must poll /api/payments/[id]/status for webhook updates and auto-redirect to confirmation view when payment is verified", () => {
    const orderDetailsPath = path.join(rootDir, "src", "app", "account", "orders", "[id]", "page.tsx");
    const content = fs.readFileSync(orderDetailsPath, "utf-8");
    assert.ok(
      content.includes("/api/payments/${orderId}/status"),
      "Must poll /api/payments/${orderId}/status to detect webhook payment updates"
    );
    assert.ok(
      content.includes("pollPaymentWebhookStatus"),
      "Must define pollPaymentWebhookStatus handler"
    );
    assert.ok(
      content.includes("router.replace(`/account/orders/${orderId}?payment=success`)"),
      "Must automatically redirect to order confirmation view once payment is verified"
    );
  });
});
