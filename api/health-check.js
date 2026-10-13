const dotenv = require("dotenv");
const {
  buildExpectedWebhookUrl,
  evaluateWebhookHealth,
  isCronAuthorized,
  formatAlertMessage
} = require("../src/services/healthCheck");

dotenv.config();

// Read-only: ask Telegram about the current webhook registration.
async function fetchWebhookInfo(token) {
  const response = await fetch(
    `https://api.telegram.org/bot${token}/getWebhookInfo`
  );
  const data = await response.json().catch(() => ({}));

  if (!response.ok || !data || data.ok !== true) {
    const error = new Error("getWebhookInfo failed");
    error.telegramError = {
      error_code: (data && data.error_code) || response.status,
      description: (data && data.description) || "unknown error"
    };
    throw error;
  }

  return data.result || {};
}

// Send one private alert to the administrator. Never changes the webhook.
async function sendAdminMessage(token, chatId, text) {
  const response = await fetch(
    `https://api.telegram.org/bot${token}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        disable_web_page_preview: true
      })
    }
  );
  const data = await response.json().catch(() => ({}));

  if (!response.ok || !data || data.ok !== true) {
    const error = new Error("sendMessage failed");
    error.telegramError = {
      error_code: (data && data.error_code) || response.status,
      description: (data && data.description) || "unknown error"
    };
    throw error;
  }

  return data.result;
}

module.exports = async (req, res) => {
  // Protect the endpoint: fail closed unless the Vercel Cron bearer matches.
  if (!process.env.CRON_SECRET) {
    console.error(
      "health-check: CRON_SECRET is not configured; endpoint disabled (fail-closed)"
    );
    res.status(401).json({ ok: false, error: "Unauthorized" });
    return;
  }

  if (!isCronAuthorized(req, process.env)) {
    console.warn("health-check: unauthorized request rejected");
    res.status(401).json({ ok: false, error: "Unauthorized" });
    return;
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const adminChatId = process.env.ADMIN_CHAT_ID;

  if (!token || !adminChatId) {
    console.error("health-check: not configured", {
      hasToken: Boolean(token),
      hasAdminChatId: Boolean(adminChatId)
    });
    res.status(500).json({ ok: false, error: "Monitoring not configured" });
    return;
  }

  // Authorized delivery self-test: send one harmless message, touch nothing else.
  const testMode = req.query && (req.query.test === "1" || req.query.test === "true");
  if (testMode) {
    try {
      await sendAdminMessage(
        token,
        adminChatId,
        "ReadMoodBot monitoring: тестовое сообщение. Доставка работает. Webhook не изменялся."
      );
      console.log("health-check: test message delivered");
      res.status(200).json({ ok: true, mode: "test", alertSent: true });
    } catch (error) {
      console.error(
        "health-check: test message failed",
        error.telegramError || { message: error.message }
      );
      res.status(502).json({ ok: false, mode: "test", alertSent: false });
    }
    return;
  }

  // Read current webhook state. A failure here is a CHECK error (e.g. Telegram
  // API unavailable), NOT proof that the bot is down.
  let info;
  try {
    info = await fetchWebhookInfo(token);
  } catch (error) {
    console.error(
      "health-check: getWebhookInfo failed (check error, not a confirmed outage)",
      error.telegramError || { message: error.message }
    );
    let alertSent = false;
    try {
      await sendAdminMessage(
        token,
        adminChatId,
        "ReadMoodBot monitoring: не удалось проверить webhook (ошибка обращения к Telegram API). Возможен временный сбой Telegram, а не отказ бота."
      );
      alertSent = true;
    } catch (sendError) {
      console.error(
        "health-check: alert send failed",
        sendError.telegramError || { message: sendError.message }
      );
    }
    res.status(502).json({ ok: false, status: "check_error", alertSent });
    return;
  }

  const { healthy, problems } = evaluateWebhookHealth(info, {
    expectedUrl: buildExpectedWebhookUrl(process.env.WEBHOOK_BASE_URL),
    nowMs: Date.now()
  });

  if (healthy) {
    console.log("health-check: healthy, no alert sent");
    res.status(200).json({ ok: true, status: "healthy" });
    return;
  }

  const problemCodes = problems.map((problem) => problem.code);
  console.warn("health-check: problems detected", { problems: problemCodes });

  let alertSent = false;
  try {
    await sendAdminMessage(
      token,
      adminChatId,
      formatAlertMessage(problems, { nowIso: new Date().toISOString() })
    );
    alertSent = true;
  } catch (error) {
    console.error(
      "health-check: alert send failed",
      error.telegramError || { message: error.message }
    );
  }

  // If a problem was detected but the alert could not be delivered, surface the
  // run as failed (502) so it is visible in the Vercel cron run history.
  res.status(alertSent ? 200 : 502).json({
    ok: alertSent,
    status: "problem",
    problems: problemCodes,
    alertSent
  });
};
