const TelegramBot = require("node-telegram-bot-api");
const { books } = require("./data/books");
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
  "Напиши автора, название книги или воспользуйся командой /find.";
const pollingBots = new Map();
let webhookBot = null;
const recommendationSeedKey = "s";
const recommendationPageKey = "n";
const bookCardPrefix = "book:";
const authorCardPrefix = "author:";

const optionCatalog = {
  goal: {
    rl: { label: "Отдохнуть", value: "relax" },
    in: { label: "Вдохновиться", value: "inspire" },
    em: { label: "Попереживать", value: "emotional" },
    rf: { label: "Подумать о жизни", value: "reflective" },
    es: { label: "Полное погружение", value: "escape" },
    dy: { label: "Хочется динамики", value: "dynamic" },
    ra: { label: "🎲 Удиви меня", value: "random" },
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
    an: { label: "Не важно", value: "any" },
  },
  pace: {
    sl: { label: "Медленный", value: "slow" },
    md: { label: "Средний", value: "medium" },
    fs: { label: "Динамичный", value: "fast" },
    vf: { label: "Стремительный", value: "very_fast" },
    an: { label: "Не важно", value: "any" },
  },
  length: {
    sh: { label: "Короткая книга", value: "short" },
    md: { label: "Средняя по объему", value: "medium" },
    lg: { label: "Надолго", value: "long" },
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

function createRecommendationSeed() {
  return Math.floor(Math.random() * 46656);
}

function serializeRecommendationState(session, recommendationState = {}) {
  const parts = [];
  const sessionState = serializeSession(session);

  if (sessionState) {
    parts.push(sessionState);
  }

  if (Number.isFinite(recommendationState.seed)) {
    parts.push(
      `${recommendationSeedKey}=${recommendationState.seed.toString(36)}`
    );
  }

  if (Number.isFinite(recommendationState.page)) {
    parts.push(
      `${recommendationPageKey}=${recommendationState.page.toString(36)}`
    );
  }

  return parts.join(";");
}

function deserializeRecommendationState(serialized) {
  const parsedState = {
    session: createEmptySession(),
    recommendationState: {
      seed: null,
      page: 0,
    },
  };

  if (!serialized) {
    return parsedState;
  }

  parsedState.session = deserializeSession(serialized);

  for (const part of serialized.split(";")) {
    const [key, value] = part.split("=");

    if (!value) {
      continue;
    }

    if (key === recommendationSeedKey) {
      const seed = Number.parseInt(value, 36);

      if (Number.isFinite(seed)) {
        parsedState.recommendationState.seed = seed;
      }
    }

    if (key === recommendationPageKey) {
      const page = Number.parseInt(value, 36);

      if (Number.isFinite(page) && page >= 0) {
        parsedState.recommendationState.page = page;
      }
    }
  }

  return parsedState;
}

function buildMoreRecommendationsCallbackData(session, recommendationState) {
  return `${moreRecommendationsPrefix}${serializeRecommendationState(
    session,
    recommendationState,
  )}`;
}

function resolveBookCoverUrl(cover) {
  if (!cover || typeof cover !== "string") {
    return null;
  }

  if (cover.startsWith("http://") || cover.startsWith("https://")) {
    return cover;
  }

  if (!cover.startsWith("/covers/")) {
    return null;
  }

  const baseUrl = process.env.WEBHOOK_BASE_URL;

  if (!baseUrl) {
    return null;
  }

  return `${baseUrl.replace(/\/+$/, "")}${cover}`;
}

function buildBookCardMessage(book, options = {}) {
  const blocks = [];

  if (options.lead) {
    blocks.push(options.lead);
  }

  blocks.push(`«${book.title}» — ${book.author}`);
  blocks.push(book.recommendationText || book.description);

  return blocks.join("\n\n");
}

async function sendBookCard(bot, chatId, book, keyboard, options = {}) {
  const message = buildBookCardMessage(book, options);
  const coverUrl = resolveBookCoverUrl(book.cover);
  const inlineKeyboard = buildBookCardKeyboard(book, keyboard);

  if (coverUrl) {
    try {
      await bot.sendPhoto(chatId, coverUrl, {
        caption: message,
        reply_markup: {
          inline_keyboard: inlineKeyboard,
        },
      });
      return;
    } catch (error) {
      console.error("Book cover send failed, falling back to text", {
        chatId,
        coverUrl,
        error: error?.message,
      });
    }
  }

  await bot.sendMessage(chatId, message, {
    reply_markup: {
      inline_keyboard: inlineKeyboard,
    },
  });
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
    [{ text: "✨ Подборки", callback_data: collectionsMenuCallbackData }],
    [{ text: "ℹ️ Как это работает", callback_data: "start_help" }],
  ];
}

function buildRecommendationsKeyboard(session, recommendationState) {
  return [
    [
      {
        text: "🔁 Еще варианты",
        callback_data: buildMoreRecommendationsCallbackData(
          session,
          recommendationState,
        ),
      },
    ],
    [{ text: "🔄 Подобрать заново", callback_data: "start_pick" }],
    [{ text: "🏠 В меню", callback_data: menuCallbackData }],
  ];
}

function buildBookCardCallbackData(book, session, recommendationState) {
  const bookIndex = books.findIndex(
    (candidate) =>
      candidate.title === book.title && candidate.author === book.author,
  );

  if (bookIndex < 0) {
    return null;
  }

  if (!session && !recommendationState) {
    return `${bookCardPrefix}${bookIndex.toString(36)}`;
  }

  return `${bookCardPrefix}${bookIndex.toString(36)}:${serializeRecommendationState(
    session,
    recommendationState,
  )}`;
}

function buildAuthorCallbackData(book) {
  const bookIndex = books.findIndex(
    (candidate) =>
      candidate.title === book.title && candidate.author === book.author,
  );

  if (bookIndex < 0) {
    return null;
  }

  return `${authorCardPrefix}${bookIndex.toString(36)}`;
}

function buildBookCardKeyboard(book, keyboard = []) {
  const authorCallbackData = buildAuthorCallbackData(book);

  if (!authorCallbackData) {
    return keyboard;
  }

  return [
    [{ text: "👤 Об авторе", callback_data: authorCallbackData }],
    ...keyboard,
  ];
}

function buildRecommendationChoiceKeyboard(
  recommendations,
  session,
  recommendationState,
) {
  const roleButtons = [
    {
      emoji: "📘",
      book: recommendations.roleRecommendations?.exact,
    },
    {
      emoji: "🌿",
      book: recommendations.roleRecommendations?.safe,
    },
    {
      emoji: "✨",
      book: recommendations.roleRecommendations?.stretch,
    },
  ]
    .filter(({ book }) => Boolean(book))
    .map(({ emoji, book }) => {
      const callbackData = buildBookCardCallbackData(
        book,
        session,
        recommendationState,
      );

      if (!callbackData) {
        return null;
      }

      return {
        text: `${emoji} ${book.title}`,
        callback_data: callbackData,
      };
    })
    .filter(Boolean);

  return [
    ...roleButtons.map((button) => [button]),
    ...buildRecommendationsKeyboard(session, recommendationState),
  ];
}

function buildRandomRecommendationKeyboard(session, recommendationState) {
  return [
    [
      {
        text: "🎲 Еще случайная книга",
        callback_data: buildMoreRecommendationsCallbackData(
          session,
          recommendationState,
        ),
      },
    ],
    [{ text: "🔄 Подобрать заново", callback_data: "start_pick" }],
    [{ text: "🏠 В меню", callback_data: menuCallbackData }],
  ];
}

function buildExhaustedRecommendationsKeyboard() {
  return [
    [{ text: "🔄 Подобрать заново", callback_data: "start_pick" }],
    [{ text: "🏠 В меню", callback_data: menuCallbackData }],
  ];
}

function buildHelpKeyboard() {
  return [
    [{ text: "📖 Что почитать?", callback_data: "start_pick" }],
    [{ text: "✨ Подборки", callback_data: collectionsMenuCallbackData }],
    [{ text: "🏠 В меню", callback_data: menuCallbackData }],
  ];
}

function buildSearchResultKeyboard() {
  return [
    [{ text: "📚 Найти другую книгу", callback_data: "start_find" }],
    [{ text: "📖 Что почитать?", callback_data: "start_pick" }],
    [{ text: "✨ Подборки", callback_data: collectionsMenuCallbackData }],
    [{ text: "🏠 В меню", callback_data: menuCallbackData }],
  ];
}

function buildSearchResultsKeyboard(localResults = []) {
  const bookButtons = localResults
    .map((book) => {
      const callbackData = buildBookCardCallbackData(book);

      if (!callbackData) {
        return null;
      }

      return [{ text: `📘 ${book.title}`, callback_data: callbackData }];
    })
    .filter(Boolean);

  return [...bookButtons, ...buildSearchResultKeyboard()];
}

function buildAuthorInfoKeyboard(authorUrl) {
  return [
    [{ text: "📖 Открыть Wikipedia", url: authorUrl }],
    [{ text: "📖 Что почитать?", callback_data: "start_pick" }],
    [{ text: "✨ Подборки", callback_data: collectionsMenuCallbackData }],
    [{ text: "🏠 В меню", callback_data: menuCallbackData }],
  ];
}

function buildCollectionsMenuKeyboard() {
  return [
    ...collections.map((collection) => [
      {
        text: collection.buttonLabel || collection.title,
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
      "Личные книжные маршруты: по теме, жанру или читательскому настроению.",
      "Выбери подборку — покажу список.",
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

async function sendRecommendations(bot, chatId, session, currentRecommendationState = {}) {
  const preferences = buildPreferences(session);
  const recommendationState = {
    seed: Number.isFinite(currentRecommendationState.seed)
      ? currentRecommendationState.seed
      : createRecommendationSeed(),
    page: Number.isFinite(currentRecommendationState.page)
      ? currentRecommendationState.page
      : 0,
  };
  console.log("Sending final recommendation", { chatId, preferences });
  const recommendations = await recommendBooks(preferences, {
    chainSeed: recommendationState.seed,
    chainPage: recommendationState.page,
  });
  const isRandom = preferences.goal === "random";
  let message = buildRecommendationMessage(preferences, recommendations);
  const nextRecommendationState = {
    seed: recommendationState.seed,
    page: recommendationState.page + 1,
  };
  let keyboard = buildRecommendationsKeyboard(session, nextRecommendationState);

  if (recommendations.exhausted) {
    keyboard = buildExhaustedRecommendationsKeyboard();
  } else if (isRandom) {
    const randomBook =
      recommendations.roleRecommendations?.exact ||
      recommendations.localRecommendations?.[0] ||
      recommendations.externalRecommendations?.[0];

    if (randomBook) {
      message = [
        "🎲 Сегодня я бы предложил тебе:",
        `«${randomBook.title}» — ${randomBook.author}`,
        randomBook.recommendationText || randomBook.description,
      ].join("\n\n");
    }

    keyboard = buildRandomRecommendationKeyboard(
      session,
      nextRecommendationState,
    );

    if (randomBook) {
      await sendBookCard(bot, chatId, randomBook, keyboard, {
        lead: "🎲 Сегодня я бы предложил тебе:",
      });
      return;
    }
  } else {
    keyboard = buildRecommendationChoiceKeyboard(
      recommendations,
      session,
      nextRecommendationState,
    );
  }

  await bot.sendMessage(
    chatId,
    message,
    {
      reply_markup: {
        inline_keyboard: keyboard,
      },
    },
  );
}

function findBookByCallbackId(callbackId) {
  const bookIndex = Number.parseInt(callbackId, 36);

  if (!Number.isFinite(bookIndex) || bookIndex < 0) {
    return null;
  }

  return books[bookIndex] || null;
}

async function resolveRussianWikipediaAuthorUrl(author) {
  const fallbackUrl = `https://ru.wikipedia.org/wiki/${encodeURIComponent(
    String(author || "").replace(/ /g, "_"),
  )}`;
  const normalizeWikipediaText = (value) =>
    String(value || "")
      .toLowerCase()
      .replace(/ё/g, "е")
      .replace(/\s+/g, " ")
      .trim();
  const extractAuthorSurname = (value) => {
    const parts = normalizeWikipediaText(value)
      .split(" ")
      .map((part) => part.replace(/\./g, "").trim())
      .filter(Boolean)
      .filter((part) => part.length > 1);

    return parts.length ? parts[parts.length - 1] : "";
  };
  const scoreWikipediaResult = (title, normalizedAuthor, surname) => {
    const normalizedTitle = normalizeWikipediaText(title);
    let score = 0;

    if (normalizedTitle === normalizedAuthor) {
      score += 100;
    }

    if (normalizedTitle.includes(normalizedAuthor)) {
      score += 80;
    }

    if (normalizedAuthor.includes(normalizedTitle)) {
      score += 60;
    }

    if (!title.includes(":")) {
      score += 20;
    }

    if (title.includes(":")) {
      score -= 30;
    }

    if (/(биография|библиография|список|экранизац)/i.test(title)) {
      score -= 40;
    }

    if (surname && normalizedTitle.includes(surname)) {
      score += 30;
    }

    return score;
  };

  try {
    const response = await fetch(
      `https://ru.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(
        author,
      )}&format=json&origin=*`,
    );

    if (!response.ok) {
      throw new Error(`Wikipedia request failed with status ${response.status}`);
    }

    const data = await response.json();
    const results = Array.isArray(data?.query?.search) ? data.query.search : [];

    if (!results.length) {
      return {
        title: author,
        url: fallbackUrl,
        found: false,
      };
    }

    const normalizedAuthor = normalizeWikipediaText(author);
    const surname = extractAuthorSurname(author);
    const rankedResults = results
      .map((result) => ({
        ...result,
        score: scoreWikipediaResult(result?.title || "", normalizedAuthor, surname),
      }))
      .sort((a, b) => b.score - a.score);
    const preferredResult = rankedResults[0];
    const title = preferredResult?.title || author;
    const normalizedTitle = normalizeWikipediaText(title);
    const lowConfidence =
      !preferredResult ||
      preferredResult.score < 50 ||
      title.includes(":") ||
      (surname && !normalizedTitle.includes(surname));

    if (lowConfidence) {
      return {
        title: author,
        url: fallbackUrl,
        found: false,
      };
    }

    const url = `https://ru.wikipedia.org/wiki/${encodeURIComponent(
      title.replace(/ /g, "_"),
    )}`;

    return {
      title,
      url,
      found: true,
    };
  } catch (error) {
    console.warn("Wikipedia author lookup failed", {
      author,
      error: error?.message,
    });

    return {
      title: author,
      url: fallbackUrl,
      found: false,
    };
  }
}

function buildAuthorInfoMessage(author, resolvedAuthor) {
  if (resolvedAuthor.found) {
    return [`👤 ${author}`, "Нашла страницу в Wikipedia."].join("\n\n");
  }

  return [
    `👤 ${author}`,
    "Не уверена, что нашла точную страницу, но можно начать отсюда.",
  ].join("\n\n");
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
      "Помогаю подобрать книгу под твое состояние: настроение, жанр, атмосферу и темп.",
      "Можно пройти короткий опрос, открыть авторские подборки или выбрать книгу из готовых карточек.",
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
  await bot.sendMessage(chatId, "Начнем заново. Поймаем другое читательское настроение.");
  await sendStep(bot, chatId, createEmptySession());
}

async function sendSearchResults(bot, chatId, query) {
  await bot.sendMessage(chatId, `Ищу книги по запросу: ${query}`);

  const searchResult = await findBooks(query);
  const message = buildFindBooksMessage(query, searchResult);

  await bot.sendMessage(chatId, message, {
    reply_markup: {
      inline_keyboard: buildSearchResultsKeyboard(searchResult.localResults),
    },
  });
}

async function handleFind(bot, chatId, text) {
  const query = extractCommandArgument(text);
  console.log("Handling /find", { chatId, query });

  if (!query) {
    await bot.sendMessage(
      chatId,
      "После /find напиши автора или название.\n\nНапример: /find Гарри Поттер",
      {
        reply_markup: {
          inline_keyboard: buildSearchResultKeyboard(),
        },
      },
    );
    return;
  }

  try {
    await sendSearchResults(bot, chatId, query);
  } catch (error) {
    console.error("Search flow failed", { chatId, query, error: error?.message });
    await bot.sendMessage(
      chatId,
      "Не смогла выполнить поиск. Попробуй еще раз чуть позже или введи другой запрос.",
      {
        reply_markup: {
          inline_keyboard: buildSearchResultKeyboard(),
        },
      },
    );
  }
}

async function handleFindQuery(bot, chatId, query) {
  const trimmedQuery = String(query || "").trim();

  if (!trimmedQuery) {
    await bot.sendMessage(chatId, findPromptText, {
      reply_markup: {
        inline_keyboard: buildSearchResultKeyboard(),
      },
    });
    return;
  }

  try {
    await sendSearchResults(bot, chatId, trimmedQuery);
  } catch (error) {
    console.error("Search flow failed", {
      chatId,
      query: trimmedQuery,
      error: error?.message,
    });
    await bot.sendMessage(
      chatId,
      "Не смогла выполнить поиск. Попробуй еще раз чуть позже или введи другой запрос.",
      {
        reply_markup: {
          inline_keyboard: buildSearchResultKeyboard(),
        },
      },
    );
  }
}

async function handleHelp(bot, chatId) {
  console.log("Handling /help", { chatId });
  await bot.sendMessage(
    chatId,
    [
      "Что я умею",
      "📖 Подобрать книгу — если хочется найти чтение под настроение, атмосферу и темп.",
      "✨ Авторские подборки — если хочется выбирать не по настроению, а по теме, жанру или читательскому интересу.",
      "🎲 Случайная книга — если хочется неожиданного, но все еще curated-варианта.",
      "👤 Карточки книг и кнопка «Об авторе» — чтобы быстро перейти от рекомендации к самой книге и дальше к контексту автора.",
      "После рекомендаций можно нажать «Еще варианты» — я покажу другую тройку без нового опроса.",
      "Если не знаешь, с чего начать, нажми «Что почитать?».",
    ].join("\n\n"),
    {
      reply_markup: {
        inline_keyboard: buildHelpKeyboard(),
      },
    },
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
    await bot.sendMessage(
      chatId,
      "Я пока понимаю команды и кнопки. Чтобы найти книгу, нажми «📚 Найти книгу» или используй /find название.",
      {
        reply_markup: {
          inline_keyboard: buildSearchResultKeyboard(),
        },
      },
    );
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
      [
        "Как это работает",
        "Я могу подобрать книгу через короткий опрос, показать авторские подборки и дать карточки книг с переходом к автору.",
        "Подбор строится не только по жанру: я смотрю на атмосферу, темп и то, чего тебе сейчас хочется от чтения.",
      ].join("\n\n"),
      {
        reply_markup: {
          inline_keyboard: buildHelpKeyboard(),
        },
      },
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
    const { session, recommendationState } = deserializeRecommendationState(
      data.slice(moreRecommendationsPrefix.length),
    );
    console.log("Decoded more recommendations session", {
      chatId,
      session,
      recommendationState,
    });
    await bot.answerCallbackQuery(query.id);
    await sendRecommendations(bot, chatId, session, recommendationState);
    return;
  }

  if (data.startsWith(bookCardPrefix)) {
    const payload = data.slice(bookCardPrefix.length);
    const separatorIndex = payload.indexOf(":");
    const bookId =
      separatorIndex >= 0 ? payload.slice(0, separatorIndex) : payload;
    const statePayload =
      separatorIndex >= 0 ? payload.slice(separatorIndex + 1) : "";
    const book = findBookByCallbackId(bookId);

    if (!book) {
      await bot.answerCallbackQuery(query.id, {
        text: "Не получилось открыть карточку книги.",
      });
      return;
    }

    const { session, recommendationState } =
      deserializeRecommendationState(statePayload);
    const keyboard = statePayload
      ? buildRecommendationsKeyboard(session, recommendationState)
      : buildSearchResultKeyboard();

    await bot.answerCallbackQuery(query.id);
    await sendBookCard(
      bot,
      chatId,
      book,
      keyboard,
    );
    return;
  }

  if (data.startsWith(authorCardPrefix)) {
    const book = findBookByCallbackId(data.slice(authorCardPrefix.length));

    if (!book) {
      await bot.answerCallbackQuery(query.id, {
        text: "Не получилось открыть автора.",
      });
      return;
    }

    const resolvedAuthor = await resolveRussianWikipediaAuthorUrl(book.author);

    await bot.answerCallbackQuery(query.id);
    await bot.sendMessage(
      chatId,
      buildAuthorInfoMessage(book.author, resolvedAuthor),
      {
      reply_markup: {
        inline_keyboard: buildAuthorInfoKeyboard(resolvedAuthor.url),
      },
      },
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
