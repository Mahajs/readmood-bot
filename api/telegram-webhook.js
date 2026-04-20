const dotenv = require("dotenv");
const { getWebhookBot, handleTelegramUpdate } = require("../src/bot");

dotenv.config();

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;

  if (!token) {
    res.status(500).json({ ok: false, error: "Missing TELEGRAM_BOT_TOKEN" });
    return;
  }

  const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const providedSecret = req.headers["x-telegram-bot-api-secret-token"];

  if (expectedSecret && providedSecret !== expectedSecret) {
    res.status(401).json({ ok: false, error: "Invalid webhook secret" });
    return;
  }

  try {
    const bot = getWebhookBot(token);
    await handleTelegramUpdate(bot, req.body);
    res.status(200).json({ ok: true });
  } catch (error) {
    console.error("Webhook handling error:", error);
    res.status(500).json({ ok: false, error: "Webhook handling failed" });
  }
};
