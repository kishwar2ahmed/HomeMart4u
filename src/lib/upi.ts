import QRCode from "qrcode";

export const MERCHANT_UPI_VPA = "9844797374@mbk";
export const MERCHANT_NAME = "homemart4u";
export const MOBIKWIK_PAYMENT_LINK = "https://w6em.app.link/wJYGFGk8v7b";

export interface UpiPaymentDetails {
  vpa: string;
  payeeName: string;
  amountRupees: number;
  orderNumber: string;
  orderId?: string;
  transactionRef?: string;
  note?: string;
  callbackUrl?: string;
}

export interface UpiIntentLinks {
  rawUpiUrl: string;
  gpayUrl: string;
  phonepeUrl: string;
  paytmUrl: string;
  mobikwikUrl: string;
  mobikwikWebLink: string;
  bhimUrl: string;
  credUrl: string;
  amazonPayUrl: string;
  genericUrl: string;
  qrDataUrl?: string;
}

/**
 * Builds the standard NPCI UPI Payment URI with literal '@' in VPA and exact 2-decimal bill amount.
 * e.g. upi://pay?pa=9844797374@mbk&pn=homemart4u&am=240.00&cu=INR&tn=Order%20FC-1001&tr=TXNFC1001...
 */
export function buildUpiUri(details: UpiPaymentDetails): string {
  const {
    vpa = MERCHANT_UPI_VPA,
    payeeName = MERCHANT_NAME,
    amountRupees,
    orderNumber,
    transactionRef = `TXN${String(orderNumber).replace(/[^a-zA-Z0-9]/g, "")}${Date.now()}`,
    note = `Order ${orderNumber}`,
    callbackUrl,
  } = details;

  const safeAmount =
    Number.isFinite(amountRupees) && amountRupees > 0 ? amountRupees : 0;

  const cleanVpa = String(vpa || MERCHANT_UPI_VPA).trim();
  const cleanPayee = encodeURIComponent(String(payeeName || MERCHANT_NAME).trim());
  const formattedAmount = safeAmount.toFixed(2);
  const cleanNote = encodeURIComponent(String(note).slice(0, 50).trim());
  const cleanTr =
    String(transactionRef)
      .replace(/[^a-zA-Z0-9]/g, "")
      .slice(0, 35) || `TXN${Date.now()}`;

  const queryParts = [
    `pa=${cleanVpa}`,
    `pn=${cleanPayee}`,
    `am=${formattedAmount}`,
    `cu=INR`,
    `tn=${cleanNote}`,
    `tr=${cleanTr}`,
    `mc=5411`,
  ];

  if (callbackUrl && callbackUrl.trim()) {
    queryParts.push(`url=${encodeURIComponent(callbackUrl.trim())}`);
  }

  return `upi://pay?${queryParts.join("&")}`;
}

/**
 * Generates app-specific intent URLs for Google Pay, PhonePe, Paytm, MobiKwik, BHIM, Cred, Amazon Pay, and standard UPI
 */
export function generateUpiIntentLinks(details: UpiPaymentDetails): UpiIntentLinks {
  const upiUri = buildUpiUri(details);
  const queryString = upiUri.replace("upi://pay?", "");

  return {
    rawUpiUrl: upiUri,
    // Google Pay direct intent
    gpayUrl: `tez://upi/pay?${queryString}`,
    // PhonePe direct intent
    phonepeUrl: `phonepe://pay?${queryString}`,
    // Paytm direct intent
    paytmUrl: `paytmmp://pay?${queryString}`,
    // MobiKwik direct UPI intent & official merchant deep link
    mobikwikUrl: `mobikwik://upi/pay?${queryString}`,
    mobikwikWebLink: MOBIKWIK_PAYMENT_LINK,
    // BHIM direct intent
    bhimUrl: `bhim://pay?${queryString}`,
    // CRED UPI intent
    credUrl: `credpay://upi/pay?${queryString}`,
    // Amazon Pay UPI intent
    amazonPayUrl: `amazonpay://upi/pay?${queryString}`,
    // Universal intent launcher (lets user select any installed UPI app)
    genericUrl: upiUri,
  };
}

/**
 * Generates a dynamic Base64 PNG Data URL for a given UPI URI
 */
export async function generateUpiQrDataUrl(upiUri: string): Promise<string> {
  try {
    return await QRCode.toDataURL(upiUri, {
      width: 340,
      margin: 2,
      errorCorrectionLevel: "M",
      color: {
        dark: "#1c1917", // Charcoal dark
        light: "#ffffff", // Pure white
      },
    });
  } catch (err) {
    console.error("Failed to generate QR code:", err);
    throw new Error("QR generation failed");
  }
}

export interface UtrValidationResult {
  isValid: boolean;
  error?: string;
  details?: {
    yearDigit: number;
    julianDay: number;
    sequence: string;
  };
}

/**
 * Validates an Indian 12-digit NPCI UPI Transaction Reference (UTR / RRN).
 *
 * Accepts all genuine 12-digit numeric UTRs across Google Pay, PhonePe, Paytm,
 * MobiKwik, BHIM, and Indian banks while rejecting dummy/test patterns:
 *   - Non-numeric inputs or lengths other than 12
 *   - All-same digits (000000000000, 111111111111, etc.)
 *   - Sequential patterns (123456789012, 987654321098, etc.)
 *   - Repetitive cyclic patterns (121212121212, 123123123123, 123412341234, etc.)
 *   - Palindromic numbers (123456654321)
 *   - Excessive single-digit dominance (> 8 occurrences of a single digit)
 *   - Low-entropy numbers with fewer than 3 unique digits
 */
export function verifyIndianUpiUtr(utr: string, orderDate?: Date): UtrValidationResult {
  const cleanUtr = String(utr || "").trim();

  // 1. Length & numeric check
  if (!/^\d{12}$/.test(cleanUtr)) {
    return {
      isValid: false,
      error: "Invalid format: UTR must be exactly 12 numeric digits (no letters or special characters).",
    };
  }

  // 2. Reject all-same digits (000000000000, 111111111111, etc.)
  if (/^(\d)\1{11}$/.test(cleanUtr)) {
    return {
      isValid: false,
      error: "Invalid UTR: Repetitive dummy number detected. Please enter the authentic 12-digit UTR from your UPI payment receipt.",
    };
  }

  // 3. Reject sequential and reverse sequential numbers
  const sequentialPatterns = [
    "012345678901",
    "123456789012",
    "234567890123",
    "345678901234",
    "456789012345",
    "567890123456",
    "678901234567",
    "789012345678",
    "890123456789",
    "901234567890",
    "987654321098",
    "876543210987",
    "765432109876",
    "654321098765",
    "543210987654",
    "432109876543",
    "321098765432",
    "210987654321",
    "109876543210",
  ];
  if (sequentialPatterns.includes(cleanUtr)) {
    return {
      isValid: false,
      error: "Invalid UTR: Sequential test numbers are not accepted. Please enter the genuine UTR from your bank app.",
    };
  }

  // 4. Reject cyclic repetitive blocks (e.g. 121212121212, 123123123123, 123412341234, 123456123456)
  const part2 = cleanUtr.slice(0, 2);
  const part3 = cleanUtr.slice(0, 3);
  const part4 = cleanUtr.slice(0, 4);
  const part6 = cleanUtr.slice(0, 6);
  if (
    cleanUtr === part2.repeat(6) ||
    cleanUtr === part3.repeat(4) ||
    cleanUtr === part4.repeat(3) ||
    cleanUtr === part6.repeat(2)
  ) {
    return {
      isValid: false,
      error: "Invalid UTR: Repeating pattern detected. Please enter the genuine transaction ID from your payment app.",
    };
  }

  // 5. Reject palindromes (e.g. 123456654321)
  const reversed = cleanUtr.split("").reverse().join("");
  if (cleanUtr === reversed) {
    return {
      isValid: false,
      error: "Invalid UTR: Symmetric test number detected. Please enter the authentic 12-digit UTR from your bank receipt.",
    };
  }

  // 6. Entropy & digit frequency check (must have at least 3 distinct digits, and no single digit > 8 times)
  const digitCounts: Record<string, number> = {};
  for (const ch of cleanUtr) {
    digitCounts[ch] = (digitCounts[ch] || 0) + 1;
    if (digitCounts[ch] > 8) {
      return {
        isValid: false,
        error: "Invalid UTR: Low-entropy or test number detected. Please enter the authentic 12-digit UTR from your bank receipt.",
      };
    }
  }

  const uniqueDigits = Object.keys(digitCounts);
  if (uniqueDigits.length < 3) {
    return {
      isValid: false,
      error: "Invalid UTR: Low-entropy or test number detected. Please enter the authentic 12-digit UTR from your bank receipt.",
    };
  }

  const julianDay = parseInt(cleanUtr.slice(1, 4), 10) || 1;

  return {
    isValid: true,
    details: {
      yearDigit: parseInt(cleanUtr[0], 10),
      julianDay,
      sequence: cleanUtr.slice(4),
    },
  };
}
