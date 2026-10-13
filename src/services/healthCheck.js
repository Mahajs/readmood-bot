"use strict";

const crypto = require("crypto");

// Defaults chosen for a once-per-day cron: an error older than ~a day is not
// treated as a current failure, and a small backlog is tolerated.
const DEFAULT_FRESH_ERROR_WINDOW_MS = 24 * 60 * 60 * 1000;
const DEFAULT_PENDING_THRESHOLD = 20;

/**
 * Expected production webhook URL, derived from WEBHOOK_BASE_URL exactly as
 * scripts/set-webhook.js builds it. Returns null when no base URL is set.
 */
function buildExpectedWebhookUrl(baseUrl) {
  const base = String(baseUrl || "").trim().replace(/\/+$/, "");

  if (!base) {
    return null;
  }

  return `${base}/api/telegram-webhook`;
}

/**
 * Pure evaluation of a Telegram getWebhookInfo `result` object. No I/O.
 * Returns { healthy: boolean, problems: [{ code, message }] }.
 *
 * Note: an empty `url` is a CONFIRMED "webhook not registered" state — distinct
 * from a check error (failure to reach Telegram), which the caller handles.
 */
function evaluateWebhookHealth(info, options = {}) {
  const expectedUrl = options.expectedUrl || null;
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
  const freshWindowMs = Number.isFinite(options.freshErrorWindowMs)
    ? options.freshErrorWindowMs
    : DEFAULT_FRESH_ERROR_WINDOW_MS;
  const pendingThreshold = Number.isFinite(options.pendingThreshold)
    ? options.pendingThreshold
    : DEFAULT_PENDING_THRESHOLD;

  const data = info || {};
  const url = typeof data.url === "string" ? data.url : "";
  const problems = [];

  if (!url) {
    problems.push({
      code: "webhook_not_registered",
      message: "Webhook is not registered (getWebhookInfo returned an empty url)."
    });
  } else if (expectedUrl && url !== expectedUrl) {
    problems.push({
      code: "webhook_url_mismatch",
      message: "Webhook url does not match the expected production address."
    });
  }

  // Only a RECENT delivery error counts: an old last_error_date is not proof of
  // a current failure.
  const lastErrorDateMs = Number.isFinite(data.last_error_date)
    ? data.last_error_date * 1000
    : null;

  if (lastErrorDateMs !== null && nowMs - lastErrorDateMs <= freshWindowMs) {
    problems.push({
      code: "recent_delivery_error",
      message: "Telegram reported a recent webhook delivery error."
    });
  }

  const pending = Number.isFinite(data.pending_update_count)
    ? data.pending_update_count
    : 0;

  if (pending > pendingThreshold) {
    problems.push({
      code: "pending_backlog",
      message: `Pending update count is high (${pending} > ${pendingThreshold}).`
    });
  }

  return { healthy: problems.length === 0, problems };
}

function timingSafeEqualString(a, b) {
  const aBuffer = Buffer.from(String(a));
  const bBuffer = Buffer.from(String(b));

  if (aBuffer.length !== bBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(aBuffer, bBuffer);
}

/**
 * Vercel Cron authorization. Vercel sends `Authorization: Bearer <CRON_SECRET>`
 * to the cron endpoint when CRON_SECRET is set. Fails CLOSED: with no
 * CRON_SECRET configured, nobody is authorized.
 */
function isCronAuthorized(req, env) {
  env = env || process.env;

  const expected = String(env.CRON_SECRET || "");

  if (!expected) {
    return false;
  }

  const headers = (req && req.headers) || {};
  const provided = headers.authorization || headers.Authorization || "";

  return timingSafeEqualString(provided, `Bearer ${expected}`);
}

/**
 * Builds the single consolidated alert text. No secrets are included.
 */
function formatAlertMessage(problems, options = {}) {
  const nowIso = options.nowIso || new Date().toISOString();
  const lines = [
    "ReadMoodBot: обнаружены проблемы с webhook.",
    `Время проверки: ${nowIso}`,
    ""
  ];

  for (const problem of problems) {
    lines.push(`- ${problem.message}`);
  }

  lines.push("");
  lines.push("Webhook автоматически НЕ изменялся. Проверьте вручную: npm run webhook:status");

  return lines.join("\n");
}

module.exports = {
  DEFAULT_FRESH_ERROR_WINDOW_MS,
  DEFAULT_PENDING_THRESHOLD,
  buildExpectedWebhookUrl,
  evaluateWebhookHealth,
  isCronAuthorized,
  formatAlertMessage
};
