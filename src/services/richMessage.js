// Прямой вызов Telegram Bot API sendRichMessage.
//
// Метод пока не поддержан библиотекой node-telegram-bot-api, поэтому обращаемся
// к HTTP API напрямую. Отправляем только вариант rich_message.html — этого
// достаточно для нашей задачи и не требует ручной сборки массива blocks.
//
// При любой ошибке функция бросает исключение (с полями error_code и
// description из ответа Telegram), чтобы вызывающий код мог сделать fallback на
// обычную отправку. В лог попадают только код и описание ошибки — без токена и
// без полного URL.

async function sendRichMessageHtml({ chatId, html, replyMarkup }) {
  const token = process.env.TELEGRAM_BOT_TOKEN;

  if (!token) {
    const error = new Error("sendRichMessage: TELEGRAM_BOT_TOKEN не задан");
    error.telegramError = { error_code: null, description: "missing token" };
    throw error;
  }

  const body = {
    chat_id: chatId,
    rich_message: { html },
  };

  if (replyMarkup) {
    body.reply_markup = replyMarkup;
  }

  const response = await fetch(
    `https://api.telegram.org/bot${token}/sendRichMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );

  const data = await response.json().catch(() => ({}));

  if (!response.ok || !data || data.ok !== true) {
    const error_code = (data && data.error_code) || response.status;
    const description = (data && data.description) || "unknown error";
    const error = new Error(
      `sendRichMessage failed: ${error_code} ${description}`,
    );
    // Только код и описание — ни токена, ни URL.
    error.telegramError = { error_code, description };
    throw error;
  }

  return data.result;
}

module.exports = { sendRichMessageHtml };
