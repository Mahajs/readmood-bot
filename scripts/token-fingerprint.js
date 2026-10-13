const dotenv = require("dotenv");
const { tokenFingerprint } = require("../src/services/botMode");

dotenv.config();

const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
  console.error("Missing TELEGRAM_BOT_TOKEN in environment variables.");
  process.exit(1);
}

console.log("SHA-256 fingerprint of the current TELEGRAM_BOT_TOKEN:");
console.log(tokenFingerprint(token));
console.log("");
console.log(
  "Run this once against the PRODUCTION token, then set the value as " +
    "PRODUCTION_BOT_TOKEN_SHA256 in your LOCAL .env (and in CI, if used). It is NOT " +
    "needed in Vercel — the production webhook handler never reads it."
);
