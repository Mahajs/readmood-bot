const TelegramBot = require("node-telegram-bot-api");
const {
  recommendBooks,
  buildRecommendationMessage,
  findBooks,
  buildFindBooksMessage,
} = require("./services/recommender");
const {
  collections,
  findCollectionByCallbackData,
} = require("./data/collections");

const callbackPrefix = "state:";
const moreRecommendationsPrefix = "more:";
const menuCallbackData = "menu";
const collectionsMenuCallbackData = "collections_menu";
const backToCollectionsCallbackData = "back_to_collections";
const backToMenuCallbackData = "back_to_menu";
const findPromptText =
  "Напиши автора, название книги или используй команду /find";
const pollingBots = new Map();
let webhookBot = null;

const optionCatalog = {
  goal: {
    rl: { label: "Отдохнуть и отвлечься", value: "relax" },
    in: { label: "Вдохновиться", value: "inspire" },
    em: { label: "Попереживать", value: "emotional" },
    rf: { label: "Подумать о жизни", value: "reflective" },
    es: { label: "Погрузиться в другой мир", value: "escape" },
    dy: { label: "Хочется динамики", value: "dynamic" },
    ra: { label: "Не знаю, просто посоветуй что-нибудь", value: "random" },
  },
  vibe: {
    cz: { label: "Уютная", value: "cozy" },
    te: { label: "Напряженная", value: "tense" },
    li: { label: "Светлая", value: "light" },
    ml: { label: "Меланхоличная", value: "melancholic" },
    my: { label: "Таинственная", value: "mysterious" },
    an: { label: "Не важно", value: "any" },
  },
  genre: {
    nv: { label: "Роман", value: "novel" },
    de: { label: "Детектив", value: "detective" },
    fa: { label: "Фэнтези", value: "fantasy" },
    sf: { label: "Фантастика", value: "sci-fi" },
    nf: { label: "Нон-фикшн", value: "non-fiction" },
    co: { label: "Современная проза", value: "contemporary" },
    cl: { label: "Классика", value: "classic" },
    an: { label: "Не принципиально", value: "any" },
  },
  pace: {
    sl: { label: "Медленный", value: "slow" },
    md: { label: "Средний", value: "medium" },
    fs: { label: "Динамичный", value: "fast" },
    vf: { label: "Очень динамичный", value: "very_fast" },
    an: { label: "Не важно", value: "any" },
  },
  length: {
    sh: { label: "Короткая книга", value: "short" },
    md: { label: "Средняя по объему", value: "medium" },
    lg: { label: "Большая, чтобы надолго", value: "long" },
    an: { label: "Не важно", value: "any" },
  },
};

const sessionSchema = [
  { key: "goal", short: "o" },
  { key: "vibe", short: "v" },
  { key: "genre", short: "g" },
  { key: "pace", short: "p" },
  { key: "length", short: "l" },
];

const steps = [
  {
    key: "goal",
    question: "Что тебе сейчас хочется получить от книги?",
    rows: [["rl", "in"], ["em", "rf"], ["es", "dy"], ["ra"]],
  },
  {
    key: "vibe",
    question: "Какая атмосфера тебе сейчас ближе?",
    rows: [["cz", "te"], ["li", "ml"], ["my", "an"]],
  },
  {
    key: "genre",
    question: "Какой жанр тебе ближе сегодня?",
    rows: [["nv", "de"], ["fa", "sf"], ["nf", "co"], ["cl", "an"]],
  },
  {
    key: "pace",
    question: "Какой темп сюжета тебе нужен?",
    rows: [["sl", "md"], ["fs", "vf"], ["an"]],
  },
  {
    key: "length",
    question: "Какой формат тебе удобнее?",
    rows: [["sh", "md"], ["lg", "an"]],
  },
];

function createEmptySession() {
  return {
    goal: null,
    vibe: null,
    genre: null,
    pace: null,
    length: null,
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
    sessionSchema.map((entry) => [entry.short, entry.key]),
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

function buildMoreRecommendationsCallbackData(session) {
  return `${moreRecommendationsPrefix}${serializeSession(session)}`;
}

function buildPreferences(session) {
  return Object.fromEntries(
    sessionSchema.map(({ key }) => [
      key,
      session[key] ? optionCatalog[key][session[key]].value : null,
    ]),
  );
}

function getNextStep(session) {
  if (session.goal === "ra") {
    return null;
  }

  return steps.find((step) => !session[step.key]);
}

function buildStepKeyboard(step, session) {
  return step.rows.map((row) =>
    row.map((code) => {
      const nextSession = { ...session, [step.key]: code };

      return {
        text: optionCatalog[step.key][code].label,
        callback_data: buildCallbackData(nextSession),
      };
    }),
  );
}

function buildStartKeyboard() {
  return [
    [{ text: "📖 Что почитать?", callback_data: "start_pick" }],
    [{ text: "📚 Найти книгу", callback_data: "start_find" }],
    [{ text: "✨ Подборки", callback_data: collectionsMenuCallbackData }],
    [{ text: "ℹ️ Как это работает", callback_data: "start_help" }],
  ];
}

function buildRecommendationsKeyboard(session) {
  return [
    [
      {
        text: "🔁 Еще варианты",
        callback_data: buildMoreRecommendationsCallbackData(session),
      },
    ],
    [{ text: "🏠 В меню", callback_data: menuCallbackData }],
  ];
}

function buildCollectionsMenuKeyboard() {
  return [
    ...collections.map((collection) => [
      {
        text: collection.title,
        callback_data: collection.callbackData,
      },
    ]),
    [{ text: "🏠 В меню", callback_data: backToMenuCallbackData }],
  ];
}

function buildCollectionKeyboard() {
  return [
    [{ text: "← К подборкам", callback_data: backToCollectionsCallbackData }],
    [{ text: "🏠 В меню", callback_data: backToMenuCallbackData }],
  ];
}

function buildCollectionMessage(collection) {
  const blocks = [
    collection.title,
    collection.intro,
    collection.books.map((book) => `• ${book}`).join("\n"),
  ];

  if (collection.startHere?.length) {
    blocks.push(
      [
        "С чего начать:",
        collection.startHere.map((item) => `• ${item}`).join("\n"),
      ].join("\n"),
    );
  }

  return blocks.join("\n\n");
}

async function sendCollectionsMenu(bot, chatId) {
  await bot.sendMessage(
    chatId,
    [
      "✨ Авторские подборки",
      "Личные книжные маршруты на разное настроение. Выбери подборку — и я покажу список.",
    ].join("\n\n"),
    {
      reply_markup: {
        inline_keyboard: buildCollectionsMenuKeyboard(),
      },
    },
  );
}

async function sendCollection(bot, chatId, collection) {
  await bot.sendMessage(chatId, buildCollectionMessage(collection), {
    reply_markup: {
      inline_keyboard: buildCollectionKeyboard(),
    },
  });
}

async function sendRecommendations(bot, chatId, session) {
  const preferences = buildPreferences(session);
  console.log("Sending final recommendation", { chatId, preferences });
  const recommendations = await recommendBooks(preferences);
  const message = buildRecommendationMessage(preferences, recommendations);

  await bot.sendMessage(
    chatId,
    `${message}\n\nЕсли хочешь подобрать заново, нажми /restart.`,
    {
      reply_markup: {
        inline_keyboard: buildRecommendationsKeyboard(session),
      },
    },
  );
}

async function sendStep(bot, chatId, session) {
  const nextStep = getNextStep(session);

  if (!nextStep) {
    await sendRecommendations(bot, chatId, session);
    return;
  }

  console.log("Sending next step", { chatId, step: nextStep.key, session });
  await bot.sendMessage(chatId, nextStep.question, {
    reply_markup: {
      inline_keyboard: buildStepKeyboard(nextStep, session),
    },
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
  return String(text || "")
    .replace(/^\/\S+\s*/, "")
    .trim();
}

async function handleStart(bot, chatId) {
  console.log("Handling /start", { chatId });
  await bot.sendMessage(
    chatId,
    [
      "Привет. Я ReadMoodBot.",
      "Помогаю подобрать книгу под твое состояние: настроение, жанр и то, чего тебе сейчас хочется от чтения.",
      "Можно ответить на пару вопросов, найти конкретную книгу или посмотреть готовые рекомендации.",
    ].join("\n\n"),
    {
      reply_markup: {
        inline_keyboard: buildStartKeyboard(),
      },
    },
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
      "После команды /find напиши название книги или автора. Например: /find Гарри Поттер",
    );
    return;
  }

  await bot.sendMessage(chatId, `Ищу книги по запросу: ${query}`);
  const searchResult = await findBooks(query);
  const message = buildFindBooksMessage(query, searchResult);
  await bot.sendMessage(chatId, message);
}

async function handleFindQuery(bot, chatId, query) {
  const trimmedQuery = String(query || "").trim();

  if (!trimmedQuery) {
    await bot.sendMessage(chatId, findPromptText);
    return;
  }

  await bot.sendMessage(chatId, `Ищу книги по запросу: ${trimmedQuery}`);
  const searchResult = await findBooks(trimmedQuery);
  const message = buildFindBooksMessage(trimmedQuery, searchResult);
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
      "/help — показать это сообщение",
    ].join("\n"),
  );
}

async function handleMessage(bot, message) {
  if (!message?.chat?.id || !message.text) {
    console.log("Skipping message without chatId/text");
    return;
  }

  const chatId = message.chat.id;
  const command = extractCommand(message.text);
  const isReplyToFindPrompt = message.reply_to_message?.text === findPromptText;
  console.log("Received message", {
    chatId,
    text: message.text,
    command,
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

  if (!command && isReplyToFindPrompt) {
    await handleFindQuery(bot, chatId, message.text);
    return;
  }

  if (command === "/help") {
    await handleHelp(bot, chatId);
    return;
  }

  if (!command) {
    await handleFindQuery(bot, chatId, message.text);
  }
}

async function handleCallbackQuery(bot, query) {
  const chatId = query?.message?.chat?.id;
  const data = query?.data || "";
  console.log("Received callback query", {
    chatId,
    data,
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
    await bot.sendMessage(chatId, findPromptText, {
      reply_markup: {
        force_reply: true,
        input_field_placeholder: "Например: Осаму Дадзай",
      },
    });
    return;
  }

  if (data === "start_collections" || data === collectionsMenuCallbackData) {
    await bot.answerCallbackQuery(query.id);
    await sendCollectionsMenu(bot, chatId);
    return;
  }

  if (data === "start_help") {
    await bot.answerCallbackQuery(query.id);
    await bot.sendMessage(
      chatId,
      "Я помогаю подобрать книгу по настроению, жанру и читательскому запросу.",
    );
    return;
  }

  if (data === menuCallbackData || data === backToMenuCallbackData) {
    await bot.answerCallbackQuery(query.id);
    await handleStart(bot, chatId);
    return;
  }

  if (data === backToCollectionsCallbackData) {
    await bot.answerCallbackQuery(query.id);
    await sendCollectionsMenu(bot, chatId);
    return;
  }

  const collection = findCollectionByCallbackData(data);

  if (collection) {
    await bot.answerCallbackQuery(query.id);
    await sendCollection(bot, chatId, collection);
    return;
  }

  if (data.startsWith(moreRecommendationsPrefix)) {
    const session = deserializeSession(
      data.slice(moreRecommendationsPrefix.length),
    );
    console.log("Decoded more recommendations session", { chatId, session });
    await bot.answerCallbackQuery(query.id);
    await sendRecommendations(bot, chatId, session);
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
    hasCallbackQuery: Boolean(update?.callback_query),
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
  handleTelegramUpdate,
};
