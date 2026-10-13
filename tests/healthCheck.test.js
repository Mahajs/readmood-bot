const test = require("node:test");
const assert = require("node:assert");

const {
  DEFAULT_FRESH_ERROR_WINDOW_MS,
  buildExpectedWebhookUrl,
  evaluateWebhookHealth,
  isCronAuthorized,
  formatAlertMessage
} = require("../src/services/healthCheck");

const EXPECTED = "https://readmood-bot.vercel.app/api/telegram-webhook";
const NOW = 1_760_000_000_000; // fixed clock for deterministic tests

function healthyInfo(overrides = {}) {
  return Object.assign(
    { url: EXPECTED, pending_update_count: 0, last_error_date: 0 },
    overrides
  );
}

test("buildExpectedWebhookUrl trims trailing slash and handles empty", () => {
  assert.strictEqual(buildExpectedWebhookUrl("https://readmood-bot.vercel.app"), EXPECTED);
  assert.strictEqual(buildExpectedWebhookUrl("https://readmood-bot.vercel.app/"), EXPECTED);
  assert.strictEqual(buildExpectedWebhookUrl(""), null);
  assert.strictEqual(buildExpectedWebhookUrl(undefined), null);
});

test("evaluateWebhookHealth: healthy when registered, matching, no fresh error, low backlog", () => {
  const result = evaluateWebhookHealth(healthyInfo(), { expectedUrl: EXPECTED, nowMs: NOW });
  assert.strictEqual(result.healthy, true);
  assert.deepStrictEqual(result.problems, []);
});

test("evaluateWebhookHealth: empty url is a confirmed 'not registered' problem", () => {
  const result = evaluateWebhookHealth(healthyInfo({ url: "" }), { expectedUrl: EXPECTED, nowMs: NOW });
  assert.strictEqual(result.healthy, false);
  assert.ok(result.problems.some((p) => p.code === "webhook_not_registered"));
});

test("evaluateWebhookHealth: url mismatch is flagged", () => {
  const result = evaluateWebhookHealth(
    healthyInfo({ url: "https://evil.example.com/api/telegram-webhook" }),
    { expectedUrl: EXPECTED, nowMs: NOW }
  );
  assert.ok(result.problems.some((p) => p.code === "webhook_url_mismatch"));
});

test("evaluateWebhookHealth: a FRESH delivery error is flagged", () => {
  const info = healthyInfo({ last_error_date: Math.floor((NOW - 60 * 60 * 1000) / 1000) }); // 1h ago
  const result = evaluateWebhookHealth(info, { expectedUrl: EXPECTED, nowMs: NOW });
  assert.ok(result.problems.some((p) => p.code === "recent_delivery_error"));
});

test("evaluateWebhookHealth: an OLD delivery error is NOT flagged", () => {
  const info = healthyInfo({ last_error_date: Math.floor((NOW - 48 * 60 * 60 * 1000) / 1000) }); // 48h ago
  const result = evaluateWebhookHealth(info, { expectedUrl: EXPECTED, nowMs: NOW });
  assert.strictEqual(result.healthy, true);
  assert.ok(!result.problems.some((p) => p.code === "recent_delivery_error"));
});

test("evaluateWebhookHealth: pending backlog over threshold is flagged", () => {
  const result = evaluateWebhookHealth(healthyInfo({ pending_update_count: 50 }), {
    expectedUrl: EXPECTED,
    nowMs: NOW,
    pendingThreshold: 20
  });
  assert.ok(result.problems.some((p) => p.code === "pending_backlog"));
});

test("evaluateWebhookHealth: multiple problems accumulate", () => {
  const info = { url: "", pending_update_count: 999, last_error_date: Math.floor(NOW / 1000) };
  const result = evaluateWebhookHealth(info, { expectedUrl: EXPECTED, nowMs: NOW });
  const codes = result.problems.map((p) => p.code);
  assert.ok(codes.includes("webhook_not_registered"));
  assert.ok(codes.includes("recent_delivery_error"));
  assert.ok(codes.includes("pending_backlog"));
});

test("isCronAuthorized: fails closed without CRON_SECRET", () => {
  assert.strictEqual(isCronAuthorized({ headers: { authorization: "Bearer x" } }, {}), false);
});

test("isCronAuthorized: accepts the correct bearer, rejects wrong/missing", () => {
  const env = { CRON_SECRET: "s3cr3t" };
  assert.strictEqual(isCronAuthorized({ headers: { authorization: "Bearer s3cr3t" } }, env), true);
  assert.strictEqual(isCronAuthorized({ headers: { authorization: "Bearer nope" } }, env), false);
  assert.strictEqual(isCronAuthorized({ headers: {} }, env), false);
});

test("formatAlertMessage lists problems and states webhook was not modified", () => {
  const msg = formatAlertMessage(
    [{ code: "webhook_not_registered", message: "Webhook is not registered." }],
    { nowIso: "2026-10-14T09:00:00.000Z" }
  );
  assert.ok(msg.includes("Webhook is not registered."));
  assert.ok(msg.includes("2026-10-14T09:00:00.000Z"));
  assert.ok(msg.includes("webhook:status"));
});

test("DEFAULT_FRESH_ERROR_WINDOW_MS is 24h", () => {
  assert.strictEqual(DEFAULT_FRESH_ERROR_WINDOW_MS, 24 * 60 * 60 * 1000);
});
