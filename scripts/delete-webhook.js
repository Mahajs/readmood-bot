const dotenv = require("dotenv");
const { requiresDeletionConfirmation } = require("../src/services/botMode");

dotenv.config();

function isTruthy(value) {
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

async function main() {
  const token = process.env.TELEGRAM_BOT_TOKEN;

  if (!token) {
    throw new Error("Missing TELEGRAM_BOT_TOKEN in environment variables.");
  }

  const confirmed =
    process.argv.includes("--yes-production") ||
    isTruthy(process.env.CONFIRM_DELETE_PRODUCTION);

  // Safe default: delete only when the token is a verified development token.
  // Otherwise (no fingerprint configured, or a production token) require an
  // explicit confirmation flag so a missing/wrong config can never silently
  // remove the production webhook.
  if (requiresDeletionConfirmation(token, process.env) && !confirmed) {
    throw new Error(
      "Refusing to delete the webhook: this token is not verified as a " +
        "development bot, so it may be PRODUCTION and deleting its webhook would " +
        "take the live bot offline (incident 2026-10-13). Set " +
        "PRODUCTION_BOT_TOKEN_SHA256 to mark a development token as safe, or re-run " +
        "with --yes-production to delete anyway."
    );
  }

  const response = await fetch(
    `https://api.telegram.org/bot${token}/deleteWebhook`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        drop_pending_updates: false
      })
    }
  );
  const data = await response.json();

  if (!response.ok || !data.ok) {
    throw new Error(`deleteWebhook failed: ${JSON.stringify(data)}`);
  }

  console.log("Webhook removed successfully.");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
