"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import Image from "next/image";
import {
  RefreshCw,
  Clock,
  ArrowRight,
  ChevronRight,
  X,
  ArrowLeft,
  Copy,
  Check,
  ShieldCheck,
  XCircle,
  CheckCircle2,
  PhoneCall,
  Banknote,
  Sparkles,
  QrCode,
  Smartphone,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/Button";

interface DynamicPaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  orderId: string;
  orderNumber: string;
  amountRupees: number;
  onSuccess: (orderId: string) => void;
  onSwitchToCod?: (orderId: string) => Promise<void> | void;
}

export const DynamicPaymentModal: React.FC<DynamicPaymentModalProps> = ({
  isOpen,
  onClose,
  orderId,
  orderNumber,
  amountRupees,
  onSuccess,
  onSwitchToCod,
}) => {
  const [loading, setLoading] = useState(true);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isSwitchingCod, setIsSwitchingCod] = useState(false);
  const [copiedUpi, setCopiedUpi] = useState(false);

  // Dynamic QR & Intent links state
  const [qrDataUrl, setQrDataUrl] = useState<string>("");
  const [rawUpiUrl, setRawUpiUrl] = useState<string>("");
  const [verifiedBillAmount, setVerifiedBillAmount] = useState<number>(amountRupees);
  const [intentLinks, setIntentLinks] = useState<{
    gpayUrl: string;
    phonepeUrl: string;
    paytmUrl: string;
    mobikwikUrl: string;
    mobikwikWebLink: string;
    bhimUrl: string;
    genericUrl: string;
  } | null>(null);

  // Payment states: PENDING | AWAITING_APP | COMPLETED | FAILED
  const [paymentStatus, setPaymentStatus] = useState<
    "PENDING" | "AWAITING_APP" | "COMPLETED" | "FAILED"
  >("PENDING");

  const [activeApp, setActiveApp] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [failureReason, setFailureReason] = useState("");
  const [countdown, setCountdown] = useState(300); // 5-minute validity
  const [utrNumber, setUtrNumber] = useState("");
  const [redirectCountdown, setRedirectCountdown] = useState(2);
  const [confirmedTxnRef, setConfirmedTxnRef] = useState<string>("");
  const [returnedFromApp, setReturnedFromApp] = useState(false);
  const utrInputRef = useRef<HTMLInputElement | null>(null);
  const onSuccessRef = useRef(onSuccess);
  useEffect(() => {
    onSuccessRef.current = onSuccess;
  }, [onSuccess]);

  const merchantVpa = "9844797374@mbk";
  const merchantName = "homemart4u";
  const mobikwikOfficialLink = "https://w6em.app.link/wJYGFGk8v7b";

  // Poll backend for live payment status
  const checkLivePaymentStatus = useCallback(async () => {
    if (!isOpen || !orderId) return;
    try {
      const res = await fetch(`/api/payments/${orderId}/status`, {
        cache: "no-store",
      });
      if (res.ok) {
        const data = await res.json();
        if (data.payment?.status === "COMPLETED") {
          setConfirmedTxnRef(
            data.payment.upiTxnRef ||
              data.payment.providerReference ||
              `UPI_${Date.now().toString().slice(-8)}`
          );
          setPaymentStatus("COMPLETED");
        } else if (data.payment?.status === "FAILED") {
          setFailureReason(
            data.payment?.failureReason ||
              "Payment session expired or was cancelled in your UPI app."
          );
          setPaymentStatus("FAILED");
        }
      }
    } catch {
      // Poll silently
    }
  }, [isOpen, orderId]);

  // Initialize payment session & generate dynamic QR for exact bill amount on modal open
  const initPaymentSession = useCallback(async () => {
    setLoading(true);
    setPaymentStatus("PENDING");
    setErrorMessage("");
    setFailureReason("");
    setUtrNumber("");
    setActiveApp(null);
    setReturnedFromApp(false);
    setCountdown(300);
    setRedirectCountdown(2);

    try {
      const res = await fetch("/api/payments/dynamic-qr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId, orderNumber, amountRupees }),
      });
      const data = await res.json();
      if (data.success) {
        const exactAmount =
          typeof data.amountRupees === "number" && data.amountRupees > 0
            ? data.amountRupees
            : amountRupees;
        setVerifiedBillAmount(exactAmount);
        setQrDataUrl(data.qrDataUrl || data.intentLinks?.qrDataUrl || "");
        setRawUpiUrl(data.rawUpiUrl || "");
        setIntentLinks({
          gpayUrl: data.intentLinks?.gpayUrl || data.rawUpiUrl,
          phonepeUrl: data.intentLinks?.phonepeUrl || data.rawUpiUrl,
          paytmUrl: data.intentLinks?.paytmUrl || data.rawUpiUrl,
          mobikwikUrl: data.intentLinks?.mobikwikUrl || data.rawUpiUrl,
          mobikwikWebLink: data.mobikwikWebLink || mobikwikOfficialLink,
          bhimUrl: data.intentLinks?.bhimUrl || data.rawUpiUrl,
          genericUrl: data.rawUpiUrl,
        });
      } else {
        setErrorMessage(data.error || "Failed to initialize payment gateway.");
      }
    } catch {
      setErrorMessage("Network issue initializing payment options. Please retry.");
    } finally {
      setLoading(false);
    }
  }, [orderId, orderNumber, amountRupees]);

  useEffect(() => {
    if (!isOpen) return;
    initPaymentSession();
  }, [isOpen, initPaymentSession]);

  // AUTOMATIC PAYMENT STATUS DETECTION: Polls backend + checks on app return (visibilitychange / focus)
  useEffect(() => {
    if (!isOpen || paymentStatus === "COMPLETED" || paymentStatus === "FAILED") return;

    const interval = setInterval(checkLivePaymentStatus, 1500);

    const handleVisibilityOrFocus = () => {
      if (document.visibilityState === "visible") {
        checkLivePaymentStatus();
        if (paymentStatus === "AWAITING_APP") {
          setReturnedFromApp(true);
          setTimeout(() => utrInputRef.current?.focus(), 150);
        }
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityOrFocus);
    window.addEventListener("focus", handleVisibilityOrFocus);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityOrFocus);
      window.removeEventListener("focus", handleVisibilityOrFocus);
    };
  }, [isOpen, paymentStatus, checkLivePaymentStatus]);

  // Auto-redirect immediately upon COMPLETED status
  useEffect(() => {
    if (paymentStatus !== "COMPLETED") return;

    const step1 = setTimeout(() => {
      setRedirectCountdown(1);
    }, 600);

    const step2 = setTimeout(() => {
      setRedirectCountdown(0);
      onSuccessRef.current(orderId);
    }, 1200);

    return () => {
      clearTimeout(step1);
      clearTimeout(step2);
    };
  }, [paymentStatus, orderId]);

  // 5-minute session countdown timer
  useEffect(() => {
    if (!isOpen || paymentStatus === "COMPLETED" || paymentStatus === "FAILED") return;

    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          setPaymentStatus("FAILED");
          setFailureReason(
            "Payment session timed out (5-minute window). You can retry or switch to COD."
          );
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [isOpen, paymentStatus]);

  // Launch chosen UPI App with exact bill amount
  const handleLaunchApp = (appName: string, intentUrl: string, fallbackUrl?: string) => {
    setActiveApp(appName);
    setPaymentStatus("AWAITING_APP");
    setReturnedFromApp(false);
    setErrorMessage("");

    const targetUrl = intentUrl || rawUpiUrl;
    if (!targetUrl || targetUrl === "#") return;

    // Trigger native UPI deep link without destroying React state on desktop browsers
    const anchor = document.createElement("a");
    anchor.href = targetUrl;
    if (targetUrl.startsWith("http://") || targetUrl.startsWith("https://")) {
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer";
    }
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);

    if (fallbackUrl && fallbackUrl !== targetUrl) {
      setTimeout(() => {
        if (document.visibilityState === "visible") {
          const fbAnchor = document.createElement("a");
          fbAnchor.href = fallbackUrl;
          fbAnchor.target = "_blank";
          fbAnchor.rel = "noopener noreferrer";
          document.body.appendChild(fbAnchor);
          fbAnchor.click();
          document.body.removeChild(fbAnchor);
        }
      }, 1200);
    }
  };

  // Verify 12-digit UTR & immediately redirect to confirmed order
  const handleVerifyUtr = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const cleanUtr = utrNumber.trim();

    if (!cleanUtr) {
      setErrorMessage("Please enter the 12-digit UTR / Reference No. from your UPI payment receipt.");
      return;
    }

    if (cleanUtr.length !== 12 || !/^\d{12}$/.test(cleanUtr)) {
      setErrorMessage(
        "UTR must be exactly 12 numeric digits (shown in your Google Pay / PhonePe / Paytm / MobiKwik receipt)."
      );
      return;
    }

    setIsVerifying(true);
    setErrorMessage("");

    try {
      const statusRes = await fetch(`/api/payments/${orderId}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "COMPLETED",
          upiTxnRef: cleanUtr,
          upiApp: activeApp || "UPI_DYNAMIC_QR",
        }),
      });

      const data = await statusRes.json().catch(() => ({}));

      if (statusRes.ok && data.success) {
        setConfirmedTxnRef(cleanUtr);
        setPaymentStatus("COMPLETED");
      } else {
        if (data.isDuplicate || data.isExpired) {
          setPaymentStatus("FAILED");
          setFailureReason(data.error);
        } else {
          setErrorMessage(data.error || "Unable to verify this UTR with bank records.");
        }
      }
    } catch {
      setErrorMessage("Network issue verifying payment reference. Please try again.");
    } finally {
      setIsVerifying(false);
    }
  };

  const handleSwitchToCodDirect = async () => {
    if (!onSwitchToCod) {
      onClose();
      return;
    }
    setIsSwitchingCod(true);
    try {
      await onSwitchToCod(orderId);
    } finally {
      setIsSwitchingCod(false);
    }
  };

  const copyUpiId = () => {
    navigator.clipboard?.writeText(merchantVpa);
    setCopiedUpi(true);
    setTimeout(() => setCopiedUpi(false), 2000);
  };

  const formatCountdown = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s < 10 ? "0" : ""}${s}`;
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-charcoal-900/80 backdrop-blur-md animate-fade-in">
      <div className="relative w-full max-w-md bg-white rounded-3xl shadow-2xl border border-stone-200 overflow-hidden flex flex-col max-h-[94vh]">
        {/* ============================================================ */}
        {/* MODAL HEADER                                                */}
        {/* ============================================================ */}
        <div className="px-5 py-3.5 bg-gradient-to-r from-stone-900 to-stone-800 text-white flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-amber-500/20 text-amber-400 border border-amber-400/30 flex items-center justify-center">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <div>
              <span className="text-[10px] font-mono tracking-widest text-amber-400 uppercase font-bold block">
                Dynamic UPI QR &amp; Instant Pay
              </span>
              <h3 className="font-sans font-bold text-sm text-white">
                Order #{orderNumber} &bull; ₹{verifiedBillAmount.toFixed(2)}
              </h3>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {paymentStatus !== "COMPLETED" && (
              <div className="flex items-center gap-1 bg-stone-800/80 px-2.5 py-1 rounded-full border border-stone-700 text-[11px] font-mono text-amber-300">
                <Clock className="w-3 h-3 text-amber-400" />
                <span>{formatCountdown(countdown)}</span>
              </div>
            )}
            <button
              onClick={onClose}
              className="p-1.5 rounded-full hover:bg-white/10 text-stone-300 hover:text-white transition"
              aria-label="Close payment modal"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* ============================================================ */}
        {/* MODAL BODY (SWITCHABLE VIEWS)                                */}
        {/* ============================================================ */}
        <div className="p-4 sm:p-5 overflow-y-auto space-y-4">
          {/* ---------------------------------------------------------- */}
          {/* 1. CUSTOM SUCCESS SCREEN (AUTO-REDIRECTS TO ORDER)         */}
          {/* ---------------------------------------------------------- */}
          {paymentStatus === "COMPLETED" ? (
            <div className="py-6 text-center space-y-5 animate-fade-in">
              <div className="relative mx-auto w-20 h-20 flex items-center justify-center">
                <div className="absolute inset-0 rounded-full bg-emerald-500/20 animate-ping opacity-75" />
                <div className="relative w-20 h-20 rounded-full bg-gradient-to-br from-emerald-500 to-emerald-600 text-white flex items-center justify-center shadow-lg shadow-emerald-600/30">
                  <CheckCircle2 className="w-10 h-10 stroke-[2.2]" />
                </div>
              </div>

              <div className="space-y-1.5">
                <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider bg-emerald-100 text-emerald-800 border border-emerald-300">
                  <Sparkles className="w-3 h-3 text-emerald-600" />
                  Payment Confirmed &amp; Order Placed
                </span>
                <h3 className="font-sans text-2xl font-bold text-stone-900">
                  ₹{verifiedBillAmount.toFixed(2)} Paid Successfully
                </h3>
                <p className="text-xs text-stone-500 font-mono">
                  Merchant: {merchantVpa} &bull; Ref: {confirmedTxnRef || `UPI_${orderNumber}`}
                </p>
              </div>

              <div className="bg-amber-50/80 border border-amber-200/80 rounded-2xl p-3.5 text-left space-y-1.5">
                <div className="flex items-center gap-2 text-amber-800 font-bold text-xs">
                  <Clock className="w-4 h-4 text-amber-600 flex-shrink-0" />
                  <span>Redirecting to Live Order Tracking...</span>
                </div>
                <p className="text-[11px] text-amber-700 leading-relaxed">
                  Your order is now placed with the kitchen. The{" "}
                  <strong>
                    20-minute delivery countdown timer will begin automatically once the store admin confirms your order
                  </strong>
                  .
                </p>
              </div>

              <div className="pt-2">
                <Button
                  variant="primary"
                  onClick={() => onSuccess(orderId)}
                  className="w-full py-3 text-sm font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl shadow-md"
                >
                  <span>Track Order Status ({redirectCountdown}s)</span>
                  <ArrowRight className="w-4 h-4 ml-1" />
                </Button>
              </div>
            </div>
          ) : /* ---------------------------------------------------------- */
          /* 2. CUSTOM FAILURE SCREEN                                   */
          /* ---------------------------------------------------------- */
          paymentStatus === "FAILED" ? (
            <div className="py-6 text-center space-y-5 animate-fade-in">
              <div className="relative mx-auto w-20 h-20 flex items-center justify-center">
                <div className="absolute inset-0 rounded-full bg-rose-500/20 animate-ping opacity-60" />
                <div className="relative w-20 h-20 rounded-full bg-gradient-to-br from-rose-500 to-rose-600 text-white flex items-center justify-center shadow-lg shadow-rose-600/30">
                  <XCircle className="w-10 h-10 stroke-[2.2]" />
                </div>
              </div>

              <div className="space-y-1.5">
                <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider bg-rose-100 text-rose-800 border border-rose-300">
                  Payment Unsuccessful
                </span>
                <h3 className="font-serif text-2xl font-bold text-stone-900">
                  Payment Incomplete
                </h3>
                <p className="text-xs text-rose-600 bg-rose-50 border border-rose-200 p-2.5 rounded-xl max-w-sm mx-auto leading-relaxed">
                  {failureReason ||
                    errorMessage ||
                    "The payment was cancelled or timed out. No amount was deducted for this order."}
                </p>
              </div>

              <div className="space-y-2.5 pt-2">
                <Button
                  variant="primary"
                  onClick={initPaymentSession}
                  className="w-full py-3 text-xs font-bold bg-stone-900 hover:bg-stone-800 text-white rounded-xl shadow-sm"
                >
                  <RefreshCw className="w-3.5 h-3.5 mr-1" />
                  <span>Regenerate Dynamic QR &amp; Try Again</span>
                </Button>

                {onSwitchToCod && (
                  <button
                    onClick={handleSwitchToCodDirect}
                    disabled={isSwitchingCod}
                    className="w-full py-2.5 bg-amber-50 hover:bg-amber-100 text-amber-900 font-bold text-xs rounded-xl border border-amber-300 transition flex items-center justify-center gap-1.5"
                  >
                    <Banknote className="w-4 h-4 text-amber-700" />
                    <span>Switch to Cash on Delivery (COD)</span>
                  </button>
                )}
              </div>

              <div className="pt-4 border-t border-stone-100 text-center">
                <span className="text-[11px] text-stone-500 block mb-1">
                  Need help completing payment?
                </span>
                <a
                  href="tel:+919035526638"
                  className="inline-flex items-center gap-1.5 text-xs font-bold text-stone-800 hover:text-amber-700 transition"
                >
                  <PhoneCall className="w-3.5 h-3.5 text-amber-600" />
                  <span>Call Store Support: +91 90355 26638</span>
                </a>
              </div>
            </div>
          ) : /* ---------------------------------------------------------- */
          /* 3. AWAITING PAYMENT IN SELECTED UPI APP                     */
          /* ---------------------------------------------------------- */
          paymentStatus === "AWAITING_APP" ? (
            <div className="py-4 space-y-4 text-center animate-fade-in">
              <div className="relative mx-auto w-14 h-14 flex items-center justify-center">
                <div className="w-14 h-14 rounded-full border-4 border-stone-200 border-t-emerald-600 animate-spin" />
                <Smartphone className="w-5 h-5 text-emerald-600 absolute" />
              </div>

              <div className="space-y-1">
                <h4 className="font-sans text-base font-bold text-stone-900">
                  Pay ₹{verifiedBillAmount.toFixed(2)} in {activeApp}
                </h4>
                <p className="text-xs text-stone-500 max-w-xs mx-auto leading-relaxed">
                  Merchant UPI ID:{" "}
                  <strong className="font-mono text-stone-800">{merchantVpa}</strong> (
                  {merchantName}). Once paid, you will be redirected automatically.
                </p>
              </div>

              <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-emerald-50 text-emerald-800 text-[11px] font-bold rounded-full border border-emerald-200">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
                <span>
                  {returnedFromApp
                    ? "Welcome back! Confirming your payment..."
                    : "Listening for live payment confirmation..."}
                </span>
              </div>

              {/* Direct MobiKwik Link fallback if MobiKwik or any app was chosen */}
              <div className="bg-stone-50 rounded-2xl p-3 border border-stone-200 text-left space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-stone-800">
                    Completed ₹{verifiedBillAmount.toFixed(2)} payment in {activeApp}?
                  </span>
                  <span className="text-[10px] font-mono text-emerald-700 font-bold">
                    Instant Order Confirm
                  </span>
                </div>

                <form onSubmit={handleVerifyUtr} className="space-y-2">
                  <input
                    ref={utrInputRef}
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={utrNumber}
                    onChange={(e) => {
                      setUtrNumber(e.target.value.replace(/\D/g, "").slice(0, 12));
                      setErrorMessage("");
                    }}
                    placeholder="Enter 12-digit UTR / UPI Ref No. from receipt"
                    maxLength={12}
                    aria-label="Enter 12-digit UTR number"
                    className="w-full px-3 py-2.5 text-xs bg-white border border-stone-300 rounded-xl font-mono text-center tracking-wider focus:outline-hidden focus:ring-2 focus:ring-emerald-600"
                  />
                  <button
                    type="submit"
                    disabled={isVerifying || utrNumber.length !== 12}
                    className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold text-xs rounded-xl shadow-sm transition flex items-center justify-center gap-1.5"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    <span>
                      {isVerifying
                        ? "Verifying & Placing Order..."
                        : "Confirm Payment & Place Order"}
                    </span>
                  </button>
                </form>

                {errorMessage && (
                  <p className="text-xs text-rose-600 bg-rose-50 p-2 rounded-xl border border-rose-200 text-center">
                    {errorMessage}
                  </p>
                )}
              </div>

              <div className="flex items-center justify-between pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setPaymentStatus("PENDING");
                    setErrorMessage("");
                  }}
                  className="text-xs font-medium text-stone-600 hover:text-stone-900 flex items-center gap-1"
                >
                  <ArrowLeft className="w-3.5 h-3.5" /> Back to QR &amp; All UPI Apps
                </button>

                {onSwitchToCod && (
                  <button
                    type="button"
                    onClick={handleSwitchToCodDirect}
                    disabled={isSwitchingCod}
                    className="text-xs text-amber-700 font-bold hover:underline"
                  >
                    Switch to COD &rarr;
                  </button>
                )}
              </div>
            </div>
          ) : (
            /* ---------------------------------------------------------- */
            /* 4. UNIFIED DYNAMIC QR (EXACT BILL AMOUNT) + UPI APP SELECT */
            /* ---------------------------------------------------------- */
            <div className="space-y-3.5 animate-fade-in">
              {/* Payment Summary Box */}
              <div className="bg-stone-50 rounded-2xl p-3 border border-stone-200 flex items-center justify-between">
                <div>
                  <span className="text-[10px] text-stone-500 uppercase font-mono font-bold block">
                    Exact Bill Amount
                  </span>
                  <span className="text-xl font-sans font-extrabold text-stone-900">
                    ₹{verifiedBillAmount.toFixed(2)}
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-[10px] text-stone-500 uppercase font-mono block">
                    Merchant UPI ID ({merchantName})
                  </span>
                  <div className="flex items-center justify-end gap-1">
                    <span className="text-xs font-mono font-bold text-stone-800">
                      {merchantVpa}
                    </span>
                    <button
                      type="button"
                      onClick={copyUpiId}
                      className="p-1 text-stone-500 hover:text-stone-900 transition"
                      title="Copy UPI ID"
                      aria-label="Copy Merchant UPI ID"
                    >
                      {copiedUpi ? (
                        <Check className="w-3.5 h-3.5 text-emerald-600" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                </div>
              </div>

              {/* DYNAMIC QR CODE SECTION (LOCKED TO EXACT BILL AMOUNT) */}
              <div className="bg-white rounded-2xl border border-stone-200 p-3.5 text-center shadow-2xs space-y-2">
                <div className="flex items-center justify-between text-[11px] text-stone-600 px-1">
                  <span className="font-bold text-stone-800 flex items-center gap-1">
                    <QrCode className="w-3.5 h-3.5 text-amber-600" />
                    Scan Dynamic QR to Pay ₹{verifiedBillAmount.toFixed(2)}
                  </span>
                  <span className="font-mono text-[10px] text-emerald-700 font-semibold">
                    Auto-Amount Locked
                  </span>
                </div>

                {loading ? (
                  <div className="w-44 h-44 mx-auto rounded-2xl bg-stone-100 animate-pulse flex flex-col items-center justify-center gap-2 border border-stone-200">
                    <RefreshCw className="w-6 h-6 text-stone-400 animate-spin" />
                    <span className="text-[11px] text-stone-500 font-mono">
                      Generating ₹{verifiedBillAmount.toFixed(2)} QR...
                    </span>
                  </div>
                ) : qrDataUrl ? (
                  <div className="relative w-44 h-44 mx-auto bg-white p-2 rounded-2xl border-2 border-stone-900/10 shadow-xs flex items-center justify-center">
                    <img
                      src={qrDataUrl}
                      alt="Dynamic UPI QR Code"
                      width={168}
                      height={168}
                      className="w-full h-full object-contain rounded-lg"
                    />
                  </div>
                ) : (
                  <div className="w-44 h-44 mx-auto rounded-2xl bg-stone-50 flex flex-col items-center justify-center gap-2 border border-stone-200 p-3">
                    <span className="text-xs text-stone-500">
                      Unable to load QR image
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={initPaymentSession}
                      className="text-xs"
                    >
                      Retry QR
                    </Button>
                  </div>
                )}

                <p className="text-[11px] text-stone-500">
                  Scan with any UPI app &bull; Exact bill{" "}
                  <strong className="text-stone-800">₹{verifiedBillAmount.toFixed(2)}</strong>{" "}
                  is pre-filled for <strong className="font-mono text-stone-800">{merchantVpa}</strong>
                </p>
              </div>

              {/* SELECT ANY UPI APP SECTION */}
              <div className="space-y-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-stone-500 block px-0.5">
                  Or Select Your UPI App to Pay ₹{verifiedBillAmount.toFixed(2)}
                </span>

                <div className="grid grid-cols-2 gap-2">
                  {/* Google Pay */}
                  <button
                    type="button"
                    onClick={() =>
                      handleLaunchApp(
                        "Google Pay",
                        intentLinks?.gpayUrl || intentLinks?.genericUrl || rawUpiUrl
                      )
                    }
                    className="p-2.5 rounded-xl border border-stone-200 hover:border-stone-400 bg-white hover:bg-stone-50 transition-all flex items-center justify-between shadow-2xs group"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="w-9 h-7 relative flex items-center justify-center bg-stone-50 rounded-lg p-1 border border-stone-100 flex-shrink-0">
                        <Image
                          src="/images/payment/gpay.png"
                          alt="Google Pay"
                          width={36}
                          height={20}
                          referrerPolicy="no-referrer"
                          className="object-contain max-h-5"
                        />
                      </div>
                      <span className="text-xs font-bold text-stone-900 truncate">
                        Google Pay
                      </span>
                    </div>
                    <ChevronRight className="w-3.5 h-3.5 text-stone-400 group-hover:text-stone-800 flex-shrink-0" />
                  </button>

                  {/* PhonePe */}
                  <button
                    type="button"
                    onClick={() =>
                      handleLaunchApp(
                        "PhonePe",
                        intentLinks?.phonepeUrl || intentLinks?.genericUrl || rawUpiUrl
                      )
                    }
                    className="p-2.5 rounded-xl border border-stone-200 hover:border-purple-300 bg-white hover:bg-purple-50/20 transition-all flex items-center justify-between shadow-2xs group"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="w-9 h-7 relative flex items-center justify-center bg-stone-50 rounded-lg p-1 border border-stone-100 flex-shrink-0">
                        <Image
                          src="/images/payment/phonepe.png"
                          alt="PhonePe"
                          width={36}
                          height={20}
                          referrerPolicy="no-referrer"
                          className="object-contain max-h-5"
                        />
                      </div>
                      <span className="text-xs font-bold text-stone-900 truncate">
                        PhonePe
                      </span>
                    </div>
                    <ChevronRight className="w-3.5 h-3.5 text-stone-400 group-hover:text-purple-700 flex-shrink-0" />
                  </button>

                  {/* Paytm */}
                  <button
                    type="button"
                    onClick={() =>
                      handleLaunchApp(
                        "Paytm",
                        intentLinks?.paytmUrl || intentLinks?.genericUrl || rawUpiUrl
                      )
                    }
                    className="p-2.5 rounded-xl border border-stone-200 hover:border-sky-300 bg-white hover:bg-sky-50/20 transition-all flex items-center justify-between shadow-2xs group"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="w-9 h-7 relative flex items-center justify-center bg-stone-50 rounded-lg p-1 border border-stone-100 flex-shrink-0">
                        <Image
                          src="/images/payment/paytm.png"
                          alt="Paytm"
                          width={36}
                          height={20}
                          referrerPolicy="no-referrer"
                          className="object-contain max-h-5"
                        />
                      </div>
                      <span className="text-xs font-bold text-stone-900 truncate">
                        Paytm UPI
                      </span>
                    </div>
                    <ChevronRight className="w-3.5 h-3.5 text-stone-400 group-hover:text-sky-700 flex-shrink-0" />
                  </button>

                  {/* MobiKwik (9844797374@mbk / Official Link) */}
                  <button
                    type="button"
                    onClick={() =>
                      handleLaunchApp(
                        "MobiKwik",
                        intentLinks?.mobikwikUrl || rawUpiUrl,
                        intentLinks?.mobikwikWebLink || mobikwikOfficialLink
                      )
                    }
                    className="p-2.5 rounded-xl border border-stone-200 hover:border-blue-400 bg-white hover:bg-blue-50/20 transition-all flex items-center justify-between shadow-2xs group"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="w-9 h-7 relative flex items-center justify-center bg-blue-600 text-white rounded-lg p-1 font-extrabold text-[10px] font-mono flex-shrink-0">
                        MBK
                      </div>
                      <span className="text-xs font-bold text-stone-900 truncate">
                        MobiKwik
                      </span>
                    </div>
                    <ChevronRight className="w-3.5 h-3.5 text-stone-400 group-hover:text-blue-700 flex-shrink-0" />
                  </button>
                </div>

                {/* Universal Any UPI App & Direct MobiKwik Payment Link Row */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      handleLaunchApp(
                        "UPI App",
                        intentLinks?.genericUrl || rawUpiUrl
                      )
                    }
                    className="w-full p-2.5 rounded-xl border border-stone-200 hover:border-emerald-300 bg-white hover:bg-emerald-50/20 transition-all flex items-center justify-between shadow-2xs group"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="w-9 h-7 flex items-center justify-center bg-emerald-50 rounded-lg border border-emerald-200 text-emerald-700 font-black text-[10px] font-mono flex-shrink-0">
                        UPI
                      </div>
                      <div className="text-left min-w-0">
                        <span className="text-xs font-bold text-stone-900 block truncate">
                          BHIM / Any UPI App
                        </span>
                      </div>
                    </div>
                    <ChevronRight className="w-3.5 h-3.5 text-stone-400 group-hover:text-emerald-700 flex-shrink-0" />
                  </button>

                  <a
                    href={mobikwikOfficialLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => {
                      setActiveApp("MobiKwik Link");
                      setPaymentStatus("AWAITING_APP");
                    }}
                    className="w-full p-2.5 rounded-xl border border-blue-200 hover:border-blue-400 bg-blue-50/40 hover:bg-blue-50 transition-all flex items-center justify-between shadow-2xs group"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <ExternalLink className="w-4 h-4 text-blue-600 flex-shrink-0" />
                      <span className="text-xs font-bold text-blue-900 truncate">
                        MobiKwik Direct Link
                      </span>
                    </div>
                    <ChevronRight className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />
                  </a>
                </div>
              </div>

              {/* Instant UTR Confirmation Box (Visible right on screen for QR Scanners & UPI App users) */}
              <div className="pt-2 border-t border-stone-200 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-stone-700">
                    Paid via QR or UPI App? Enter 12-Digit UTR to Auto-Confirm:
                  </span>
                </div>
                <form onSubmit={handleVerifyUtr} className="flex gap-2">
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={utrNumber}
                    onChange={(e) => {
                      setUtrNumber(e.target.value.replace(/\D/g, "").slice(0, 12));
                      setErrorMessage("");
                    }}
                    placeholder="12-digit UPI UTR / Ref No."
                    maxLength={12}
                    aria-label="12-digit UPI UTR reference"
                    className="flex-1 px-3 py-2 text-xs border border-stone-300 rounded-xl font-mono text-center tracking-wider focus:outline-hidden focus:ring-2 focus:ring-emerald-600 bg-stone-50/70"
                  />
                  <Button
                    type="submit"
                    variant="primary"
                    disabled={isVerifying || utrNumber.length !== 12}
                    className="text-xs bg-emerald-600 hover:bg-emerald-700 font-bold px-4 rounded-xl"
                  >
                    {isVerifying ? "Verifying..." : "Verify & Place"}
                  </Button>
                </form>
              </div>

              {errorMessage && (
                <p className="text-xs text-rose-600 bg-rose-50 p-2.5 rounded-xl border border-rose-200 text-center animate-fade-in">
                  {errorMessage}
                </p>
              )}
            </div>
          )}
        </div>

        {/* ============================================================ */}
        {/* MODAL FOOTER                                                */}
        {/* ============================================================ */}
        {paymentStatus !== "COMPLETED" && (
          <div className="px-5 py-3 bg-stone-50 border-t border-stone-200 flex items-center justify-between text-xs">
            <span className="text-[11px] text-stone-500 flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
              <span>NPCI Verified &bull; {merchantVpa}</span>
            </span>

            {onSwitchToCod && (
              <button
                type="button"
                onClick={handleSwitchToCodDirect}
                disabled={isSwitchingCod}
                className="font-bold text-amber-800 hover:text-amber-900 transition flex items-center gap-1 hover:underline text-[11px]"
              >
                <Banknote className="w-3.5 h-3.5 text-amber-600" />
                <span>Switch to Cash on Delivery</span>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
