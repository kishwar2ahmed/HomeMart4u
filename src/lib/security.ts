import crypto from "crypto";

/**
 * Security & Sanitization Utilities
 * Protects against XSS, script injection, HTML injection, timing attacks,
 * signature forgery, replay attacks, and malformed inputs.
 */

const replayCache = new Map<string, number>();
const MAX_REPLAY_CACHE_SIZE = 5000;

/**
 * Constant-time string comparison using SHA-256 digests and crypto.timingSafeEqual.
 * Prevents timing side-channel attacks from leaking secret lengths or characters.
 */
export function timingSafeCompareStrings(a: unknown, b: unknown): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (!a || !b) return false;

  const hashA = crypto.createHash("sha256").update(a, "utf8").digest();
  const hashB = crypto.createHash("sha256").update(b, "utf8").digest();

  const hashesMatch = crypto.timingSafeEqual(hashA, hashB);
  return hashesMatch && a.length === b.length;
}

/**
 * Cryptographically verifies an HMAC-SHA256 hex signature in constant time.
 * Strictly validates 64-character hex format to prevent Buffer.from truncation bypasses.
 */
export function verifyHmacSha256Signature(
  payload: string,
  signatureHex: unknown,
  secret: unknown
): boolean {
  if (typeof payload !== "string" || typeof signatureHex !== "string" || typeof secret !== "string") {
    return false;
  }
  const cleanSig = signatureHex.trim().toLowerCase();
  if (!secret || !/^[0-9a-f]{64}$/.test(cleanSig)) {
    return false;
  }

  const expectedHex = crypto
    .createHmac("sha256", secret)
    .update(payload, "utf8")
    .digest("hex");

  const sigBuf = Buffer.from(cleanSig, "hex");
  const expBuf = Buffer.from(expectedHex, "hex");

  if (sigBuf.length !== 32 || expBuf.length !== 32) {
    return false;
  }

  return crypto.timingSafeEqual(sigBuf, expBuf);
}

/**
 * Detects and blocks replay attacks within a sliding TTL window (default 10 minutes).
 * Returns true if the key has already been seen within the TTL window.
 */
export function isReplayAttack(replayKey: string, ttlMs = 10 * 60 * 1000): boolean {
  if (!replayKey) return true;
  const now = Date.now();

  // Periodic cleanup of expired entries
  if (replayCache.size > MAX_REPLAY_CACHE_SIZE) {
    for (const [key, expiresAt] of replayCache.entries()) {
      if (expiresAt <= now) {
        replayCache.delete(key);
      }
    }
  }

  const digestKey = crypto.createHash("sha256").update(replayKey).digest("hex");
  const existingExpiry = replayCache.get(digestKey);

  if (existingExpiry && existingExpiry > now) {
    return true;
  }

  replayCache.set(digestKey, now + ttlMs);
  return false;
}

/**
 * Escapes characters with HTML entities to prevent Cross-Site Scripting (XSS).
 */
export function escapeHtml(str: string): string {
  if (!str || typeof str !== "string") return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Strips HTML tags and harmful characters completely.
 */
export function stripHtmlTags(str: string): string {
  if (!str || typeof str !== "string") return "";
  return str.replace(/<[^>]*>?/gm, "").trim();
}

/**
 * Sanitizes generic user text (e.g. customer name, instructions, reviews, address notes).
 * Strips potential HTML, JavaScript URLs, script blocks, and limits max length.
 */
export function sanitizeText(input: unknown, maxLength = 500): string {
  if (input === null || input === undefined) return "";
  let val = String(input);
  // Remove control characters except newline and tab
  val = val.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
  // Strip HTML tags
  val = stripHtmlTags(val);
  // Disallow javascript: or data: URI schemes in text
  val = val.replace(/(javascript|vbscript|data):/gi, "");
  return val.slice(0, maxLength);
}

/**
 * Validates and normalizes 10-digit Indian mobile numbers.
 */
export function sanitizeMobile(input: unknown): string | null {
  if (!input) return null;
  const cleaned = String(input).replace(/[^\d+]/g, "").replace(/^\+91/, "");
  const digitsOnly = cleaned.replace(/\D/g, "");
  if (digitsOnly.length === 10 && /^[6-9]\d{9}$/.test(digitsOnly)) {
    return digitsOnly;
  }
  return null;
}

export function isValidIndianMobile(input: unknown): boolean {
  return sanitizeMobile(input) !== null;
}

/**
 * Sanitizes and validates standard email addresses.
 */
export function sanitizeEmail(input: unknown): string | null {
  if (!input) return null;
  const email = String(input).trim().toLowerCase().slice(0, 255);
  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  if (emailRegex.test(email)) {
    return email;
  }
  return null;
}

/**
 * Sanitizes address input objects
 */
export function sanitizeAddress(addr: any) {
  if (!addr || typeof addr !== "object") return null;
  const lat = Number(addr.latitude);
  const lng = Number(addr.longitude);
  return {
    label: sanitizeText(addr.label || "Home", 50),
    addressLine: sanitizeText(addr.addressLine, 250),
    locality: sanitizeText(addr.locality || "Mulbagal", 100),
    city: sanitizeText(addr.city || "Mulbagal", 80),
    postalCode: sanitizeText(addr.postalCode || "563131", 10).replace(/[^\d]/g, ""),
    latitude: Number.isFinite(lat) && lat >= -90 && lat <= 90 ? lat : 13.1645,
    longitude: Number.isFinite(lng) && lng >= -180 && lng <= 180 ? lng : 78.3952,
  };
}
