const dotenv = require("dotenv");

dotenv.config();

function formatTimestamp(seconds) {
  if (!seconds) {
    return "—";
  }

  return new Date(seconds * 1000).toISOString();
}

async function main() {
  const token = process.env.TELEGRAM_BOT_TOKEN;

  if (!token) {
    throw new Error("Missing TELEGRAM_BOT_TOKEN in environment variables.");
  }

  const response = await fetch(
    `https://api.telegram.org/bot${token}/getWebhookInfo`
  );
  const data = await response.json();

  if (!response.ok || !data.ok) {
    throw new Error(`getWebhookInfo failed: ${JSON.stringify(data)}`);
  }

  const info = data.result || {};

  console.log("Telegram webhook status (read-only):");
  console.log(`  url:                     ${info.url || "(empty — webhook NOT registered)"}`);
  console.log(`  pending_update_count:    ${info.pending_update_count ?? "—"}`);
  console.log(`  ip_address:              ${info.ip_address || "—"}`);
  console.log(`  last_error_date:         ${formatTimestamp(info.last_error_date)}`);
  console.log(`  last_error_message:      ${info.last_error_message || "—"}`);
  console.log(`  last_sync_error_date:    ${formatTimestamp(info.last_synchronization_error_date)}`);
  console.log(`  max_connections:         ${info.max_connections ?? "—"}`);
  console.log(`  has_custom_certificate:  ${Boolean(info.has_custom_certificate)}`);
  console.log(`  allowed_updates:         ${JSON.stringify(info.allowed_updates || [])}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
