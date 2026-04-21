const TelegramBot = require("node-telegram-bot-api");
const {
  recommendBooks,
  buildRecommendationMessage,
  findBooks,
  buildFindBooksMessage
} = require("./services/recommender");

const callbackPrefix = "state:";
const pollingBots = new Map();
let webhookBot = null;

const optionCatalog = {
  format: {
    h: { label: "Художественная", value: "художественная" },
    n: { label: "Нон-фикшн", value: "нон-фикшн" }
  },
  genre: {
    sf: { label: "Фантастика", value: "фантастика" },
    fa: { label: "Фэнтези", value: "фэнтези" },
    ps: { label: "Психология", value: "психология" },
    hi: { label: "История", value: "история" },
    sh: { label: "Саморазвитие", value: "саморазвитие" },
    fi: { label: "Художественная литература", value: "художественная литература" },
    pr: { label: "Продуктивность", value: "продуктивность" }
  },
  mood: {
    li: { label: "Легкое", value: "легкое" },
    th: { label: "Вдумчивое", value: "вдумчивое" },
    em: { label: "Эмоциональное", value: "эмоциональное" },
    pa: { label: "Практичное", value: "практичное" },
    ad: { label: "Приключенческое", value: "приключенческое" },
    mo: { label: "Мотивирующее", value: "мотивирующее" }
  },
  length: {
    s: { label: "Короткая", value: "короткая" },
    m: { label: "Средняя", value: "средняя" },
    l: { label: "Длинная", value: "длинная" }
  },
  goal: {
    rl: { label: "Отдохнуть", value: "отдохнуть" },
    ln: { label: "Узнать новое", value: "узнать новое" },
    rf: { label: "Подумать", value: "подумать" },
    in: { label: "Вдохновиться", value: "вдохновиться" },
    im: { label: "Погрузиться в мир", value: "погрузиться в мир" },
    ef: { label: "Стать эффективнее", value: "стать эффективнее" }
  }
};

const sessionSchema = [
  { key: "format", short: "f" },
  { key: "genre", short: "g" },
  { key: "mood", short: "m" },
  { key: "length", short: "l" },
  { key: "goal", short: "o" }
];

const steps = [
  {
    key: "format",
    question: "Для начала выбери формат книги:",
    rows: [["h"], ["n"]]
  },
  {
    key: "genre",
    question: "Теперь жанр:",
    rows: [
      ["sf", "fa"],
      ["ps", "hi"],
      ["sh", "fi"],
      ["pr"]
    ]
  },
  {
    key: "mood",
    question: "Какое сейчас настроение или желаемая атмосфера?",
    rows: [
      ["li", "th"],
      ["em", "pa"],
      ["ad", "mo"]
    ]
  },
  {
    key: "length",
    question: "Какую длину книги выбрать?",
    rows: [["s", "m"], ["l"]]
  },
  {
    key: "goal",
    question: "И последняя настройка: зачем хочешь почитать именно сейчас?",
    rows: [
      ["rl", "ln"],
      ["rf", "in"],
      ["im", "ef"]
    ]
  }
];

function createEmptySession() {
  return {
    format: null,
    genre: null,
    mood: null,
    length: null,
    goal: null
  };
}

function serializeSession(session) {
  return sessionSchema
    .filter(({ key }) => session[key])
    .map(({ key, short }) => `${short}=${session[key]}`)
    .join(";");
}

function deserializeSession(serialized) {
  const session = createEmptySession();

  if (!serialized) {
    return session;
  }

  const shortToKey = Object.fromEntries(
    sessionSchema.map((entry) => [entry.short, entry.key])
  );

  for (const part of serialized.split(";")) {
    const [short, value] = part.split("=");
    const key = shortToKey[short];

    if (key && value && optionCatalog[key][value]) {
      session[key] = value;
    }
  }

  return session;
}

function buildCallbackData(session) {
  return `${callbackPrefix}${serializeSession(session)}`;
}

function buildPreferences(session) {
  return Object.fromEntries(
    sessionSchema.map(({ key }) => [
      key,
      session[key] ? optionCatalog[key][session[key]].value : null
    ])
  );
}

function getNextStep(session) {
  return steps.find((step) => !session[step.key]);
}

function buildStepKeyboard(step, session) {
  return step.rows.map((row) =>
    row.map((code) => {
      const nextSession = { ...session, [step.key]: code };

      return {
        text: optionCatalog[step.key][code].label,
        callback_data: buildCallbackData(nextSession)
      };
    })
  );
}

function buildStartKeyboard() {
  return [
    [{ text: "📗 Подобрать книгу", callback_data: "start_pick" }],
    [{ text: "📚 Найти книгу", callback_data: "start_find" }],
    [{ text: "✨ Подборки", callback_data: "start_collections" }],
    [{ text: "ℹ️ Как это работает", callback_data: "start_help" }]
  ];
}

async function sendStep(bot, chatId, session) {
  const nextStep = getNextStep(session);

  if (!nextStep) {
    const preferences = buildPreferences(session);
    console.log("Sending final recommendation", { chatId, preferences });
    const recommendations = await recommendBooks(preferences);
    const message = buildRecommendationMessage(preferences, recommendations);

    await bot.sendMessage(
      chatId,
      `${message}\n\nЕсли хочешь подобрать заново, нажми /restart.`
    );
    return;
  }

  console.log("Sending next step", { chatId, step: nextStep.key, session });
  await bot.sendMessage(chatId, nextStep.question, {
    reply_markup: {
      inline_keyboard: buildStepKeyboard(nextStep, session)
    }
  });
}

function extractCommand(text) {
  if (!text || !text.startsWith("/")) {
    return null;
  }

  const [command] = text.trim().split(/\s+/);
  return command.split("@")[0];
}

function extractCommandArgument(text) {
  return String(text || "").replace(/^\/\S+\s*/, "").trim();
}

async function handleStart(bot, chatId) {
  console.log("Handling /start", { chatId });
  await bot.sendMessage(
    chatId,
    [
      "Привет. Я ReadMoodBot.",
      "Помогаю подобрать книгу под твое состояние: настроение, жанр и то, чего тебе сейчас хочется от чтения.",
      "Можно ответить на пару вопросов, найти конкретную книгу или посмотреть готовые рекомендации."
    ].join("\n\n"),
    {
      reply_markup: {
        inline_keyboard: buildStartKeyboard()
      }
    }
  );
}

async function handleRestart(bot, chatId) {
  console.log("Handling /restart", { chatId });
  await bot.sendMessage(chatId, "Начинаем заново.");
  await sendStep(bot, chatId, createEmptySession());
}

async function handleFind(bot, chatId, text) {
  const query = extractCommandArgument(text);
  console.log("Handling /find", { chatId, query });

  if (!query) {
    await bot.sendMessage(
      chatId,
      "После команды /find напиши название книги или автора. Например: /find Гарри Поттер"
    );
    return;
  }

  await bot.sendMessage(chatId, `Ищу книги по запросу: ${query}`);
  const searchResult = await findBooks(query);
  const message = buildFindBooksMessage(query, searchResult);
  await bot.sendMessage(chatId, message);
}

async function handleHelp(bot, chatId) {
  console.log("Handling /help", { chatId });
  await bot.sendMessage(
    chatId,
    [
      "Команды:",
      "/start — начать подбор книг",
      "/restart — пройти опрос заново",
      "/find <запрос> — найти книгу по названию или автору",
      "/help — показать это сообщение"
    ].join("\n")
  );
}

async function handleMessage(bot, message) {
  if (!message?.chat?.id || !message.text) {
    console.log("Skipping message without chatId/text");
    return;
  }

  const chatId = message.chat.id;
  const command = extractCommand(message.text);
  console.log("Received message", {
    chatId,
    text: message.text,
    command
  });

  if (command === "/start") {
    await handleStart(bot, chatId);
    return;
  }

  if (command === "/restart") {
    await handleRestart(bot, chatId);
    return;
  }

  if (command === "/find") {
    await handleFind(bot, chatId, message.text);
    return;
  }

  if (command === "/help") {
    await handleHelp(bot, chatId);
  }
}

async function handleCallbackQuery(bot, query) {
  const chatId = query?.message?.chat?.id;
  const data = query?.data || "";
  console.log("Received callback query", {
    chatId,
    data
  });

  if (!chatId) {
    console.log("Ignoring callback query", { chatId, data });
    return;
  }

  if (data === "start_pick") {
    await bot.answerCallbackQuery(query.id);
    await sendStep(bot, chatId, createEmptySession());
    return;
  }

  if (data === "start_find") {
    await bot.answerCallbackQuery(query.id);
    await bot.sendMessage(
      chatId,
      "Напиши автора, название книги или используй команду /find"
    );
    return;
  }

  if (data === "start_collections") {
    await bot.answerCallbackQuery(query.id);
    await bot.sendMessage(chatId, "Подборки скоро появятся.");
    return;
  }

  if (data === "start_help") {
    await bot.answerCallbackQuery(query.id);
    await bot.sendMessage(
      chatId,
      "Я помогаю подобрать книгу по настроению, жанру и читательскому запросу."
    );
    return;
  }

  if (!data.startsWith(callbackPrefix)) {
    console.log("Ignoring callback query", { chatId, data });
    return;
  }

  const session = deserializeSession(data.slice(callbackPrefix.length));
  console.log("Decoded callback session", { chatId, session });
  await bot.answerCallbackQuery(query.id);
  await sendStep(bot, chatId, session);
}

async function handleTelegramUpdate(bot, update) {
  console.log("Handling telegram update", {
    hasMessage: Boolean(update?.message),
    hasCallbackQuery: Boolean(update?.callback_query)
  });

  if (update.message) {
    await handleMessage(bot, update.message);
  }

  if (update.callback_query) {
    await handleCallbackQuery(bot, update.callback_query);
  }
}

function attachPollingHandlers(bot) {
  bot.on("message", async (message) => {
    try {
      await handleMessage(bot, message);
    } catch (error) {
      console.error("Message handling error:", error);
    }
  });

  bot.on("callback_query", async (query) => {
    try {
      await handleCallbackQuery(bot, query);
    } catch (error) {
      console.error("Callback query handling error:", error);
    }
  });

  bot.on("polling_error", (error) => {
    console.error("Polling error:", error.message);
  });
}

function createBot(token, options = {}) {
  const mode = options.mode || "polling";
  const bot = new TelegramBot(token, { polling: mode === "polling" });

  if (mode === "polling") {
    attachPollingHandlers(bot);
    console.log("Book recommendation bot is running in polling mode...");
  }

  return bot;
}

function getPollingBot(token) {
  if (!pollingBots.has(token)) {
    pollingBots.set(token, createBot(token, { mode: "polling" }));
  }

  return pollingBots.get(token);
}

function getWebhookBot(token) {
  if (!webhookBot) {
    webhookBot = createBot(token, { mode: "webhook" });
  }

  return webhookBot;
}

module.exports = {
  createBot,
  getPollingBot,
  getWebhookBot,
  handleTelegramUpdate
};
