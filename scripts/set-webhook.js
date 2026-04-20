const dotenv = require("dotenv");

dotenv.config();

async function main() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const baseUrl = process.env.WEBHOOK_BASE_URL;
  const secretToken = process.env.TELEGRAM_WEBHOOK_SECRET;

  if (!token) {
    throw new Error("Missing TELEGRAM_BOT_TOKEN in environment variables.");
  }

  if (!baseUrl) {
    throw new Error("Missing WEBHOOK_BASE_URL in environment variables.");
  }

  const normalizedBaseUrl = baseUrl.replace(/\/$/, "");
  const webhookUrl = `${normalizedBaseUrl}/api/telegram-webhook`;
  const payload = {
    url: webhookUrl,
    drop_pending_updates: false
  };

  if (secretToken) {
    payload.secret_token = secretToken;
  }

  const response = await fetch(
    `https://api.telegram.org/bot${token}/setWebhook`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    }
  );
  const data = await response.json();

  if (!response.ok || !data.ok) {
    throw new Error(`setWebhook failed: ${JSON.stringify(data)}`);
  }

  console.log("Webhook configured successfully.");
  console.log(`Webhook URL: ${webhookUrl}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
