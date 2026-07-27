const test = require("node:test");
const assert = require("node:assert/strict");

const { sendRichMessageHtml } = require("../src/services/richMessage");

// Подменяем глобальный fetch и токен на время теста, потом возвращаем как было.
function withStubbedFetch(impl, token, run) {
  const originalFetch = global.fetch;
  const originalToken = process.env.TELEGRAM_BOT_TOKEN;

  global.fetch = impl;
  if (token === undefined) {
    delete process.env.TELEGRAM_BOT_TOKEN;
  } else {
    process.env.TELEGRAM_BOT_TOKEN = token;
  }

  return Promise.resolve()
    .then(run)
    .finally(() => {
      global.fetch = originalFetch;
      if (originalToken === undefined) {
        delete process.env.TELEGRAM_BOT_TOKEN;
      } else {
        process.env.TELEGRAM_BOT_TOKEN = originalToken;
      }
    });
}

test("формирует корректный запрос к sendRichMessage", async () => {
  let captured = null;

  await withStubbedFetch(
    async (url, options) => {
      captured = { url, options };
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, result: { message_id: 42 } }),
      };
    },
    "TEST_TOKEN",
    async () => {
      const result = await sendRichMessageHtml({
        chatId: 777,
        html: "<h2>Заголовок</h2><p>Текст</p>",
        replyMarkup: { inline_keyboard: [[{ text: "OK", callback_data: "ok" }]] },
      });

      assert.deepEqual(result, { message_id: 42 });
    },
  );

  // URL содержит метод, но проверяем и то, что токен не «утёк» в теле лога — сам
  // запрос его, разумеется, содержит; это лишь проверка формы вызова.
  assert.match(captured.url, /\/sendRichMessage$/);
  assert.equal(captured.options.method, "POST");

  const body = JSON.parse(captured.options.body);
  assert.equal(body.chat_id, 777);
  assert.equal(body.rich_message.html, "<h2>Заголовок</h2><p>Текст</p>");
  assert.ok(body.reply_markup, "reply_markup должен передаваться");
  // rich_message поддерживает ровно один вариант — тут это html.
  assert.deepEqual(Object.keys(body.rich_message), ["html"]);
});

test("не добавляет reply_markup, если он не передан", async () => {
  let body = null;

  await withStubbedFetch(
    async (url, options) => {
      body = JSON.parse(options.body);
      return { ok: true, status: 200, json: async () => ({ ok: true, result: {} }) };
    },
    "TEST_TOKEN",
    async () => {
      await sendRichMessageHtml({ chatId: 1, html: "<p>hi</p>" });
    },
  );

  assert.equal("reply_markup" in body, false);
});

test("бросает ошибку с кодом и описанием при ответе Telegram ok:false", async () => {
  await withStubbedFetch(
    async () => ({
      ok: false,
      status: 400,
      json: async () => ({
        ok: false,
        error_code: 400,
        description: "Bad Request: RICH_MESSAGE_INVALID",
      }),
    }),
    "TEST_TOKEN",
    async () => {
      await assert.rejects(
        () => sendRichMessageHtml({ chatId: 1, html: "<p>x</p>" }),
        (error) => {
          assert.equal(error.telegramError.error_code, 400);
          assert.match(error.telegramError.description, /RICH_MESSAGE_INVALID/);
          // Ни токена, ни URL в сообщении об ошибке.
          assert.doesNotMatch(error.message, /TEST_TOKEN|api\.telegram\.org/);
          return true;
        },
      );
    },
  );
});

test("бросает ошибку, если токен не задан (без сетевого вызова)", async () => {
  let fetchCalled = false;

  await withStubbedFetch(
    async () => {
      fetchCalled = true;
      return { ok: true, status: 200, json: async () => ({ ok: true, result: {} }) };
    },
    undefined,
    async () => {
      await assert.rejects(() => sendRichMessageHtml({ chatId: 1, html: "<p>x</p>" }));
    },
  );

  assert.equal(fetchCalled, false, "без токена не должно быть сетевого вызова");
});
