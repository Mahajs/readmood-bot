const dotenv = require("dotenv");

dotenv.config();

async function main() {
  const token = process.env.TELEGRAM_BOT_TOKEN;

  if (!token) {
    throw new Error("Missing TELEGRAM_BOT_TOKEN in environment variables.");
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
