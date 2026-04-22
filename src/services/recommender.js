const { books } = require("../data/books");
const {
  searchGoogleBooks,
  searchGoogleBooksByText,
  createBookIdentity
} = require("./googleBooks");

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9]+/gi, " ")
    .trim();
}

const goalToLegacyGoalsMap = {
  relax: ["отдохнуть"],
  inspire: ["вдохновиться"],
  emotional: ["подумать", "вдохновиться"],
  reflective: ["подумать", "узнать новое"],
  escape: ["погрузиться в мир"],
  dynamic: ["отдохнуть", "погрузиться в мир"]
};

const goalToThemeMap = {
  relax: ["уют", "дружба", "путешествие", "дом", "тепло"],
  inspire: ["надежда", "рост", "сила духа", "любовь"],
  emotional: ["любовь", "потеря", "одиночество", "дружба", "травма"],
  reflective: ["одиночество", "смысл", "идентичность", "свобода", "общество"],
  escape: ["мифология", "магия", "тайна", "мир", "приключение"],
  dynamic: ["приключение", "тайна", "выживание", "интрига"]
};

const vibeToLegacyMoodMap = {
  cozy: ["легкое", "обнадеживающее"],
  tense: ["мрачное", "приключенческое"],
  light: ["легкое", "мотивирующее", "обнадеживающее"],
  melancholic: ["эмоциональное", "вдумчивое"],
  mysterious: ["вдумчивое", "мрачное", "приключенческое"]
};

const vibeToVibeMap = {
  cozy: ["cozy", "warm"],
  tense: ["tense", "dark"],
  light: ["light", "uplifting"],
  melancholic: ["melancholic", "quiet", "reflective"],
  mysterious: ["mysterious", "dark"]
};

const genreToLegacyGenreMap = {
  novel: ["художественная литература"],
  detective: ["художественная литература"],
  fantasy: ["фэнтези"],
  "sci-fi": ["фантастика"],
  "non-fiction": ["психология", "история", "саморазвитие", "продуктивность"],
  contemporary: ["художественная литература"],
  classic: ["художественная литература"]
};

const lengthToLegacyLengthMap = {
  short: ["короткая"],
  medium: ["средняя"],
  long: ["длинная"]
};

const paceToLegacyMoodMap = {
  slow: ["вдумчивое", "эмоциональное"],
  medium: ["легкое", "вдумчивое", "практичное"],
  fast: ["приключенческое", "легкое"],
  very_fast: ["приключенческое"]
};

const heavySafeThemes = [
  "саморазрушение",
  "травма",
  "страх",
  "отчуждение"
];

const comfortVibes = ["cozy", "warm", "light", "uplifting", "neutral"];
const difficultSafeVibes = ["dark", "melancholic"];
const cozySafeVibes = ["cozy", "warm", "light"];
const cozyUnsafeVibes = ["melancholic", "dark", "tense"];

const directHeavyRequests = ["emotional", "reflective"];

function getBookVibes(book) {
  return Array.isArray(book.vibe) ? book.vibe : [];
}

function allowsMelancholicSafe(preferences) {
  return preferences.vibe === "melancholic";
}

function allowsHeavySafeThemes(preferences) {
  return (
    preferences.vibe === "melancholic" ||
    preferences.vibe === "tense" ||
    directHeavyRequests.includes(preferences.goal)
  );
}

const randomRecommendationPlan = {
  exact: [
    "Цветы для Элджернона",
    "Хоббит, или Туда и обратно",
    "Кухня",
    "Полночная библиотека",
    "Вторая жизнь Уве",
    "Гарри Поттер и философский камень"
  ],
  safe: [
    "Вторая жизнь Уве",
    "Хоббит, или Туда и обратно",
    "Гарри Поттер и философский камень",
    "Марсианин",
    "Автостопом по галактике",
    "Чудеса универсама «Намиа»"
  ],
  stretch: [
    "Человек-комбини",
    "Жертва подозреваемого X",
    "Кафка на пляже",
    "Имя ветра",
    "Ваш покорный слуга кот",
    "Проект «Аве Мария»"
  ]
};

const randomTopLimit = 6;

function intersects(values, candidates) {
  if (!Array.isArray(values) || !Array.isArray(candidates)) {
    return false;
  }

  return candidates.some((candidate) => values.includes(candidate));
}

function includesAny(values, candidates) {
  if (!Array.isArray(values) || !Array.isArray(candidates)) {
    return false;
  }

  return values.some((value) => candidates.includes(value));
}

function matchesAny(value, candidates) {
  return value && Array.isArray(candidates) && candidates.includes(value);
}

function scoreBook(book, preferences) {
  let score = 0;

  if (
    preferences.genre &&
    preferences.genre !== "any" &&
    matchesAny(book.genre, genreToLegacyGenreMap[preferences.genre])
  ) {
    score += 4;
  }

  if (
    preferences.genre === "non-fiction" &&
    book.format === "нон-фикшн"
  ) {
    score += 3;
  }

  if (
    preferences.length &&
    preferences.length !== "any" &&
    matchesAny(book.length, lengthToLegacyLengthMap[preferences.length])
  ) {
    score += 2;
  }

  if (
    preferences.vibe &&
    preferences.vibe !== "any" &&
    includesAny(book.mood, vibeToLegacyMoodMap[preferences.vibe])
  ) {
    score += 3;
  }

  if (
    preferences.goal &&
    preferences.goal !== "random" &&
    includesAny(book.goal, goalToLegacyGoalsMap[preferences.goal])
  ) {
    score += 3;
  }

  if (
    preferences.vibe &&
    preferences.vibe !== "any" &&
    intersects(book.vibe, vibeToVibeMap[preferences.vibe])
  ) {
    score += 2;
  }

  if (
    preferences.goal &&
    preferences.goal !== "random" &&
    intersects(book.themes, goalToThemeMap[preferences.goal])
  ) {
    score += 2;
  }

  if (
    preferences.pace &&
    preferences.pace !== "any" &&
    book.pace === preferences.pace
  ) {
    score += 2;
  }

  if (
    preferences.pace &&
    preferences.pace !== "any" &&
    includesAny(book.mood, paceToLegacyMoodMap[preferences.pace])
  ) {
    score += 1;
  }

  return score;
}

function isHighComplexity(book) {
  return book.complexity === "high" || book.complexity === "сложная";
}

function isSlowPaced(book) {
  return book.pace === "slow" || book.pace === "медленная";
}

function hasTooManyHeavySafeThemes(book, preferences) {
  if (allowsHeavySafeThemes(preferences) || !Array.isArray(book.themes)) {
    return false;
  }

  const heavyThemeCount = book.themes.filter((theme) =>
    heavySafeThemes.includes(theme)
  ).length;

  return heavyThemeCount > 0 && heavyThemeCount >= Math.ceil(book.themes.length / 2);
}

function hasDifficultSafeVibe(book, preferences) {
  const vibes = getBookVibes(book);

  if (vibes.includes("dark")) {
    return true;
  }

  return vibes.includes("melancholic") && !allowsMelancholicSafe(preferences);
}

function isSafeBook(book, preferences) {
  return (
    !isHighComplexity(book) &&
    !isSlowPaced(book) &&
    !hasDifficultSafeVibe(book, preferences) &&
    !hasTooManyHeavySafeThemes(book, preferences)
  );
}

function getSafeScore(book, preferences) {
  const vibes = getBookVibes(book);
  let safeScore = book.score;

  if (intersects(vibes, comfortVibes)) {
    safeScore += 2;
  }

  if (preferences.vibe === "cozy" && intersects(vibes, cozySafeVibes)) {
    safeScore += 3;
  }

  if (preferences.vibe === "cozy" && intersects(vibes, cozyUnsafeVibes)) {
    safeScore -= 3;
  }

  if (intersects(vibes, difficultSafeVibes)) {
    safeScore -= 2;
  }

  if (book.complexity === "low") {
    safeScore += 1;
  }

  if (book.pace === "fast") {
    safeScore += 1;
  }

  return safeScore;
}

function sortSafeCandidates(candidates, preferences) {
  return [...candidates].sort(
    (a, b) => getSafeScore(b, preferences) - getSafeScore(a, preferences)
  );
}

function hasDifferentTasteVector(book, exactBook) {
  if (!exactBook) {
    return true;
  }

  const differentGenre = book.genre !== exactBook.genre;
  const exactVibe = Array.isArray(exactBook.vibe) ? exactBook.vibe : [];
  const bookVibe = Array.isArray(book.vibe) ? book.vibe : [];
  const differentVibe = !bookVibe.some((vibe) => exactVibe.includes(vibe));

  return differentGenre || differentVibe;
}

function pickFirstUnique(candidates, usedIds) {
  return candidates.find((book) => {
    const id = createBookIdentity(book.title, book.author);
    return !usedIds.has(id);
  });
}

function pickRandomFromTop(candidates, usedIds, topLimit = randomTopLimit) {
  const availableCandidates = candidates.filter((book) => {
    const id = createBookIdentity(book.title, book.author);
    return !usedIds.has(id);
  });
  const topCandidates = availableCandidates.slice(0, topLimit);

  if (!topCandidates.length) {
    return null;
  }

  const randomIndex = Math.floor(Math.random() * topCandidates.length);
  return topCandidates[randomIndex];
}

function findBookByTitle(title) {
  return books.find((book) => book.title === title);
}

function pickRandomRecommendations() {
  const usedIds = new Set();
  const randomPreferences = { goal: "random", vibe: "any" };
  const exactCandidates = randomRecommendationPlan.exact
    .map(findBookByTitle)
    .filter(Boolean);
  const safeCandidates = randomRecommendationPlan.safe
    .map(findBookByTitle)
    .filter((book) => book && isSafeBook(book, randomPreferences));
  const stretchCandidates = randomRecommendationPlan.stretch
    .map(findBookByTitle)
    .filter((book) => book && !isHighComplexity(book));
  const exact = pickRandomFromTop(exactCandidates, usedIds);

  if (exact) {
    usedIds.add(createBookIdentity(exact.title, exact.author));
  }

  const safe = pickRandomFromTop(safeCandidates, usedIds);

  if (safe) {
    usedIds.add(createBookIdentity(safe.title, safe.author));
  }

  const stretch = pickRandomFromTop(stretchCandidates, usedIds);

  return {
    exact,
    safe,
    stretch
  };
}

function buildRoleRecommendations(preferences) {
  if (preferences.goal === "random") {
    return pickRandomRecommendations();
  }

  const scoredBooks = books
    .map((book) => ({
      ...book,
      score: scoreBook(book, preferences)
    }))
    .filter((book) => book.score > 0)
    .sort((a, b) => b.score - a.score);
  const usedIds = new Set();
  const exact = scoredBooks[0] || null;

  if (exact) {
    usedIds.add(createBookIdentity(exact.title, exact.author));
  }

  const safe =
    pickFirstUnique(
      sortSafeCandidates(
        scoredBooks.filter(
          (book) => book.score >= 3 && isSafeBook(book, preferences)
        ),
        preferences
      ),
      usedIds
    ) ||
    pickFirstUnique(
      sortSafeCandidates(
        scoredBooks.filter((book) => isSafeBook(book, preferences)),
        preferences
      ),
      usedIds
    );

  if (safe) {
    usedIds.add(createBookIdentity(safe.title, safe.author));
  }

  const stretch =
    pickFirstUnique(
      scoredBooks.filter(
        (book) =>
          book.score >= 2 &&
          !isHighComplexity(book) &&
          hasDifferentTasteVector(book, exact)
      ),
      usedIds
    ) || pickFirstUnique(scoredBooks, usedIds);

  return {
    exact,
    safe,
    stretch
  };
}

function recommendLocalBooks(preferences, limit = 3) {
  return books
    .map((book) => ({
      ...book,
      score: scoreBook(book, preferences)
    }))
    .filter((book) => book.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function findLocalBooks(query, limit = 5) {
  const normalizedQuery = normalizeText(query);

  if (!normalizedQuery) {
    return [];
  }

  return books
    .map((book) => {
      const haystack = normalizeText(
        [
          book.title,
          book.author,
          book.description,
          book.recommendationText,
          ...(book.vibe || []),
          ...(book.themes || []),
          book.pace || "",
          book.complexity || ""
        ].join(" ")
      );
      const titleScore = normalizeText(book.title).includes(normalizedQuery) ? 5 : 0;
      const authorScore = normalizeText(book.author).includes(normalizedQuery) ? 4 : 0;
      const textScore = haystack.includes(normalizedQuery) ? 2 : 0;

      return {
        ...book,
        score: titleScore + authorScore + textScore
      };
    })
    .filter((book) => book.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

async function recommendBooks(preferences, options = {}) {
  const roleRecommendations = buildRoleRecommendations(preferences);

  if (roleRecommendations.exact || roleRecommendations.safe || roleRecommendations.stretch) {
    return {
      roleRecommendations,
      localRecommendations: Object.values(roleRecommendations).filter(Boolean),
      externalRecommendations: [],
      externalError: null
    };
  }

  const localLimit = options.localLimit || 3;
  const externalLimit = options.externalLimit || 3;
  const localRecommendations = recommendLocalBooks(preferences, localLimit);
  let externalRecommendations = [];
  let externalError = null;

  try {
    const externalBooks = await searchGoogleBooks(preferences, {
      limit: externalLimit * 2
    });
    const localIds = new Set(
      localRecommendations.map((book) => createBookIdentity(book.title, book.author))
    );

    externalRecommendations = externalBooks
      .filter(
        (book) => !localIds.has(createBookIdentity(book.title, book.author))
      )
      .slice(0, externalLimit);
  } catch (error) {
    externalError = error;
  }

  return {
    localRecommendations,
    externalRecommendations,
    externalError
  };
}

async function findBooks(query, options = {}) {
  const localLimit = options.localLimit || 5;
  const externalLimit = options.externalLimit || 5;
  const localResults = findLocalBooks(query, localLimit);
  let externalResults = [];
  let externalError = null;

  try {
    const remoteResults = await searchGoogleBooksByText(query, {
      limit: externalLimit * 2
    });
    const localIds = new Set(
      localResults.map((book) => createBookIdentity(book.title, book.author))
    );

    externalResults = remoteResults
      .filter((book) => !localIds.has(createBookIdentity(book.title, book.author)))
      .slice(0, externalLimit);
  } catch (error) {
    externalError = error;
  }

  return {
    localResults,
    externalResults,
    externalError
  };
}

function buildRecommendationMessage(preferences, recommendationSet) {
  if (recommendationSet.roleRecommendations) {
    const { exact, safe, stretch } = recommendationSet.roleRecommendations;
    const blocks = [["Вот что я бы предложил:"]];

    if (exact) {
      blocks.push([
        "Самое точное попадание",
        `${exact.title} — ${exact.author}`,
        exact.recommendationText || exact.description
      ]);
    }

    if (safe) {
      blocks.push([
        "Более легкий вариант",
        `${safe.title} — ${safe.author}`,
        safe.recommendationText || safe.description
      ]);
    }

    if (stretch) {
      blocks.push([
        "Вариант чуть в сторону",
        `${stretch.title} — ${stretch.author}`,
        stretch.recommendationText || stretch.description
      ]);
    }

    return blocks.map((block) => block.join("\n")).join("\n\n");
  }

  const { localRecommendations, externalRecommendations, externalError } =
    recommendationSet;
  const hasRecommendations =
    localRecommendations.length > 0 || externalRecommendations.length > 0;

  if (!hasRecommendations) {
    return "Пока не получилось найти хороший вариант под эти параметры. Попробуй изменить один из них или начать подбор заново.";
  }

  const summary = [
    "Вот что я бы порекомендовал:",
    `Жанр: ${preferences.genre || "любой"}`,
    `Настроение: ${preferences.mood || "любое"}`,
    `Формат: ${preferences.format || "любой"}`,
    `Длина: ${preferences.length || "любая"}`,
    `Цель: ${preferences.goal || "любая"}`
  ].join("\n");

  const blocks = [];

  if (localRecommendations.length) {
    blocks.push(
      [
        "Из моей базы:",
        localRecommendations
          .map(
            (book, index) =>
              `${index + 1}. ${book.title} — ${book.author}\n${
                book.recommendationText || book.description
              }`
          )
          .join("\n\n")
      ].join("\n")
    );
  }

  if (externalRecommendations.length) {
    blocks.push(
      [
        "Еще варианты из Google Books:",
        externalRecommendations
          .map(
            (book, index) =>
              `${index + 1}. ${book.title} — ${book.author}\n${book.recommendationText}`
          )
          .join("\n\n")
      ].join("\n")
    );
  }

  if (externalError) {
    blocks.push(
      "Google Books сейчас не отвечает, поэтому показываю только варианты из моей базы."
    );
  }

  return `${summary}\n\n${blocks.join("\n\n")}`;
}

function buildFindBooksMessage(query, searchResult) {
  const { localResults, externalResults, externalError } = searchResult;
  const hasResults = localResults.length > 0 || externalResults.length > 0;

  if (!hasResults) {
    return [
      `По запросу "${query}" ничего не нашлось.`,
      "Попробуй другое название, фамилию автора или более короткий запрос."
    ].join("\n\n");
  }

  const blocks = [`Вот что нашлось по запросу "${query}":`];

  if (localResults.length) {
    blocks.push(
      [
        "В моей базе:",
        localResults
          .map(
            (book, index) =>
              `${index + 1}. ${book.title} — ${book.author}\n${
                book.recommendationText || book.description
              }`
          )
          .join("\n\n")
      ].join("\n")
    );
  }

  if (externalResults.length) {
    blocks.push(
      [
        "Во внешней базе Google Books:",
        externalResults
          .map(
            (book, index) =>
              `${index + 1}. ${book.title} — ${book.author}\n${book.recommendationText}`
          )
          .join("\n\n")
      ].join("\n")
    );
  }

  if (externalError) {
    blocks.push(
      "Google Books сейчас не отвечает, поэтому показываю только результаты из моей базы."
    );
  }

  return blocks.join("\n\n");
}

module.exports = {
  findBooks,
  findLocalBooks,
  recommendBooks,
  recommendLocalBooks,
  buildRecommendationMessage,
  buildFindBooksMessage
};
