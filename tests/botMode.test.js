const test = require("node:test");
const assert = require("node:assert");
const crypto = require("crypto");

const {
  tokenFingerprint,
  isProductionToken,
  looksLikeProductionWebhookUrl,
  assertPollingAllowed,
  requiresDeletionConfirmation
} = require("../src/services/botMode");

const PROD_TOKEN = "111111:PRODUCTION-dummy-token-for-tests";
const DEV_TOKEN = "222222:DEVELOPMENT-dummy-token-for-tests";
const PROD_FP = crypto.createHash("sha256").update(PROD_TOKEN).digest("hex");

test("tokenFingerprint: stable 64-char hex, trims, handles empty", () => {
  assert.match(tokenFingerprint(PROD_TOKEN), /^[0-9a-f]{64}$/);
  assert.strictEqual(tokenFingerprint(PROD_TOKEN), PROD_FP);
  assert.strictEqual(tokenFingerprint(`  ${PROD_TOKEN}  `), PROD_FP);
  assert.strictEqual(tokenFingerprint(""), null);
  assert.strictEqual(tokenFingerprint(undefined), null);
});

test("isProductionToken: matches only the configured fingerprint", () => {
  const env = { PRODUCTION_BOT_TOKEN_SHA256: PROD_FP };
  assert.strictEqual(isProductionToken(PROD_TOKEN, env), true);
  assert.strictEqual(isProductionToken(DEV_TOKEN, env), false);
  assert.strictEqual(isProductionToken(PROD_TOKEN, {}), false);
});

test("assertPollingAllowed: production token is hard-blocked even with ALLOW_POLLING=true", () => {
  const env = { PRODUCTION_BOT_TOKEN_SHA256: PROD_FP, ALLOW_POLLING: "true" };
  assert.throws(
    () => assertPollingAllowed(PROD_TOKEN, env),
    (error) => error.code === "POLLING_PRODUCTION_TOKEN"
  );
});

test("assertPollingAllowed: refused by default without ALLOW_POLLING (dev token)", () => {
  const env = { PRODUCTION_BOT_TOKEN_SHA256: PROD_FP };
  assert.throws(
    () => assertPollingAllowed(DEV_TOKEN, env),
    (error) => error.code === "POLLING_NOT_ALLOWED"
  );
});

test("assertPollingAllowed: allowed for dev token with ALLOW_POLLING=true", () => {
  const env = { PRODUCTION_BOT_TOKEN_SHA256: PROD_FP, ALLOW_POLLING: "true" };
  assert.strictEqual(assertPollingAllowed(DEV_TOKEN, env), true);
});

test("assertPollingAllowed: backstop blocks when no fingerprint + real webhook URL", () => {
  const env = {
    ALLOW_POLLING: "true",
    WEBHOOK_BASE_URL: "https://readmood-bot.vercel.app"
  };
  assert.throws(
    () => assertPollingAllowed(DEV_TOKEN, env),
    (error) => error.code === "POLLING_UNVERIFIED"
  );
});

test("assertPollingAllowed: placeholder/local webhook URL does not block dev polling", () => {
  assert.strictEqual(
    assertPollingAllowed(DEV_TOKEN, {
      ALLOW_POLLING: "true",
      WEBHOOK_BASE_URL: "http://localhost:3000"
    }),
    true
  );
  assert.strictEqual(
    assertPollingAllowed(DEV_TOKEN, {
      ALLOW_POLLING: "true",
      WEBHOOK_BASE_URL: "https://your-project.vercel.app"
    }),
    true
  );
});

test("looksLikeProductionWebhookUrl: real vs placeholder/local", () => {
  assert.strictEqual(looksLikeProductionWebhookUrl("https://readmood-bot.vercel.app"), true);
  assert.strictEqual(looksLikeProductionWebhookUrl("http://localhost:3000"), false);
  assert.strictEqual(looksLikeProductionWebhookUrl("https://your-project.vercel.app"), false);
  assert.strictEqual(looksLikeProductionWebhookUrl(""), false);
});

test("requiresDeletionConfirmation: safe default — only a verified dev token skips confirmation", () => {
  // No fingerprint configured -> cannot verify -> confirmation required,
  // regardless of WEBHOOK_BASE_URL being empty or misconfigured.
  assert.strictEqual(requiresDeletionConfirmation(DEV_TOKEN, {}), true);
  assert.strictEqual(requiresDeletionConfirmation(DEV_TOKEN, { WEBHOOK_BASE_URL: "" }), true);
  assert.strictEqual(requiresDeletionConfirmation(PROD_TOKEN, {}), true);
  // Fingerprint configured + production token -> confirmation required.
  assert.strictEqual(
    requiresDeletionConfirmation(PROD_TOKEN, { PRODUCTION_BOT_TOKEN_SHA256: PROD_FP }),
    true
  );
  // Fingerprint configured + verified development token -> no confirmation needed.
  assert.strictEqual(
    requiresDeletionConfirmation(DEV_TOKEN, { PRODUCTION_BOT_TOKEN_SHA256: PROD_FP }),
    false
  );
});
