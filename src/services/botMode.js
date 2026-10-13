"use strict";

const crypto = require("crypto");

/**
 * One-way fingerprint of a bot token. Lets us recognise a specific token
 * (e.g. the production one) without ever storing or revealing its value.
 */
function tokenFingerprint(token) {
  if (!token || typeof token !== "string") {
    return null;
  }

  const trimmed = token.trim();

  if (!trimmed) {
    return null;
  }

  return crypto.createHash("sha256").update(trimmed).digest("hex");
}

function isTruthy(value) {
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

/**
 * True only when the given token matches the configured production fingerprint.
 * If no fingerprint is configured, we cannot positively classify the token as
 * production, so this returns false (and callers fall back to other guards).
 */
function isProductionToken(token, env) {
  env = env || process.env;

  const configured = String(env.PRODUCTION_BOT_TOKEN_SHA256 || "")
    .trim()
    .toLowerCase();

  if (!configured) {
    return false;
  }

  const fingerprint = tokenFingerprint(token);

  return Boolean(fingerprint) && fingerprint === configured;
}

/**
 * Heuristic backstop used only when no production fingerprint is configured:
 * does WEBHOOK_BASE_URL look like a real deployment (not localhost/placeholder)?
 */
function looksLikeProductionWebhookUrl(baseUrl) {
  const url = String(baseUrl || "").trim();

  if (!/^https:\/\//i.test(url)) {
    return false;
  }

  return !/your-project|example\.|localhost|127\.0\.0\.1|0\.0\.0\.0|ngrok/i.test(url);
}

/**
 * Throws unless it is safe to start long polling with this token.
 *
 * Polling and webhooks are mutually exclusive: node-telegram-bot-api, on a 409
 * conflict, silently unsets the active webhook (see telegramPolling.js). Running
 * polling with the production token therefore deletes the production webhook and
 * takes the live bot offline — exactly the 2026-10-13 incident.
 */
function assertPollingAllowed(token, env) {
  env = env || process.env;

  // 1. Hard block: never poll with the production token. Not overridable.
  if (isProductionToken(token, env)) {
    const error = new Error(
      "Refusing to start polling with the PRODUCTION bot token. Polling deletes " +
        "the production webhook and takes the live bot offline (incident " +
        "2026-10-13). Use a separate development bot token for local polling."
    );
    error.code = "POLLING_PRODUCTION_TOKEN";
    throw error;
  }

  // 2. Polling is opt-in and off by default, so an accidental `npm start`
  //    never starts polling on its own.
  if (!isTruthy(env.ALLOW_POLLING)) {
    const error = new Error(
      "Polling is disabled by default. To run locally in polling mode, use a " +
        "development bot token and set ALLOW_POLLING=true (npm run dev does this " +
        "for you)."
    );
    error.code = "POLLING_NOT_ALLOWED";
    throw error;
  }

  // 3. Backstop when the production fingerprint is not configured: if the token
  //    cannot be ruled out as production and a real webhook URL is set, refuse.
  const prodFingerprintConfigured = Boolean(
    String(env.PRODUCTION_BOT_TOKEN_SHA256 || "").trim()
  );

  if (!prodFingerprintConfigured && looksLikeProductionWebhookUrl(env.WEBHOOK_BASE_URL)) {
    const error = new Error(
      "Refusing to poll: PRODUCTION_BOT_TOKEN_SHA256 is not configured, so this " +
        "token cannot be distinguished from production, and WEBHOOK_BASE_URL points " +
        "to a real deployment. Configure PRODUCTION_BOT_TOKEN_SHA256 (see README)."
    );
    error.code = "POLLING_UNVERIFIED";
    throw error;
  }

  return true;
}

/**
 * Safe default for the destructive webhook deletion. Require explicit
 * confirmation UNLESS the token is positively verified as a non-production
 * (development) token. "Verified dev" means the production fingerprint is
 * configured AND the current token does not match it. Without a configured
 * fingerprint we cannot prove the token is non-production, so we require
 * confirmation — even if WEBHOOK_BASE_URL is missing or misconfigured.
 */
function requiresDeletionConfirmation(token, env) {
  env = env || process.env;

  const prodFingerprintConfigured = Boolean(
    String(env.PRODUCTION_BOT_TOKEN_SHA256 || "").trim()
  );
  const verifiedDevelopmentToken =
    prodFingerprintConfigured && !isProductionToken(token, env);

  return !verifiedDevelopmentToken;
}

module.exports = {
  tokenFingerprint,
  isProductionToken,
  looksLikeProductionWebhookUrl,
  assertPollingAllowed,
  requiresDeletionConfirmation,
};
