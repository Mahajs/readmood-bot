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

// Первый вопрос — про состояние читателя. Значения соответствуют кнопкам
// optionCatalog.goal в bot.js: Отдохнуть / Вдохновиться / Попереживать /
// Подумать о жизни / Полное погружение (+ случайный режим).
const goalToLegacyGoalsMap = {
  relax: ["отдохнуть"],
  inspire: ["вдохновиться"],
  emotional: ["попереживать"],
  reflective: ["подумать", "узнать новое"],
  immerse: ["погрузиться в мир"]
};

const goalToThemeMap = {
  relax: ["уют", "дружба", "путешествие", "дом", "тепло"],
  inspire: ["надежда", "рост", "сила духа", "любовь"],
  emotional: ["любовь", "потеря", "одиночество", "дружба", "травма"],
  reflective: ["одиночество", "смысл", "идентичность", "свобода", "общество"],
  immerse: ["мифология", "магия", "тайна", "мир", "приключение"]
};

// Третий вопрос стал адаптивным: у каждого жанра свой набор ответов, но все они
// сводятся к одному словарю «tone». Каждый токен описывает множество vibe (или
// mood — для нон-фикшна, где атмосфера не работает, а различает цель чтения).
// Флаги: heavy — читатель готов к тяжёлому (влияет на подбор «safe»),
// melancholic — допускает меланхоличное в «safe», comfort — просит уюта/лёгкости.
const toneCatalog = {
  // Детектив
  calm: { vibes: ["cozy", "quiet", "reflective", "light"], comfort: true },
  puzzle: { vibes: ["mysterious"] },
  tense: { vibes: ["tense"], heavy: true },
  grim: { vibes: ["dark"], heavy: true },
  // Классика
  heavy: { vibes: ["dark", "tense"], heavy: true },
  quiet: { vibes: ["melancholic", "quiet", "reflective"], melancholic: true },
  lightcl: { vibes: ["light", "warm", "mysterious"], comfort: true },
  // Фантастика
  adventure: { vibes: ["light"], comfort: true },
  ideas: { vibes: ["mysterious", "tense", "melancholic"], heavy: true },
  // Фэнтези
  cozyfan: { vibes: ["cozy", "warm"], comfort: true },
  epic: { vibes: ["mysterious", "tense"] },
  // Нон-фикшн (по mood, а не по vibe)
  practical: { moods: ["практичное", "мотивирующее"] },
  curious: { moods: ["любознательное"] },
  // Роман / «не важно» — общий тон
  prlight: { vibes: ["cozy", "warm", "light", "uplifting"], comfort: true },
  prsad: { vibes: ["melancholic", "quiet", "reflective"], melancholic: true },
  prdark: { vibes: ["dark", "tense", "mysterious", "neutral"], heavy: true }
};

function toneProfile(tone) {
  return tone && tone !== "any" ? toneCatalog[tone] || null : null;
}

function toneFlag(preferences, flag) {
  const profile = toneProfile(preferences.tone);
  return Boolean(profile && profile[flag]);
}

const genreToLegacyGenreMap = {
  novel: ["художественная литература"],
  detective: ["художественная литература"],
  fantasy: ["фэнтези"],
  "sci-fi": ["фантастика"],
  "non-fiction": ["психология", "история", "саморазвитие", "продуктивность"],
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
  fast: ["приключенческое", "легкое"]
};

// Отдельной категории "very_fast" больше нет — она слита с "fast". Значение
// всё ещё встречается в books.js и в старых callback_data, поэтому приводим его
// здесь, а не правим данные.
function normalizePace(pace) {
  return pace === "very_fast" ? "fast" : pace;
}

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

// Состояния, прямо сигналящие готовность к тяжёлому чтению. Остальную «тяжесть»
// сообщает адаптивный тон (флаг heavy).
const directHeavyRequests = ["emotional", "reflective"];

function getBookVibes(book) {
  return Array.isArray(book.vibe) ? book.vibe : [];
}

function allowsMelancholicSafe(preferences) {
  return toneFlag(preferences, "melancholic");
}

function allowsHeavySafeThemes(preferences) {
  return (
    toneFlag(preferences, "heavy") ||
    directHeavyRequests.includes(preferences.goal)
  );
}

const recommendationRoles = ["exact", "safe", "stretch"];

const structuredGenreProfiles = {
  detective: {
    // В каталоге крупный криминальный пласт, который раньше не попадал в ответ
    // «Детектив». Классическая головоломка ловилась только по теме «детектив»,
    // а нуар, скандинавский криминал и мистические новеллы Рампо — нет: их темы
    // (преступление, расследование, тайна) не совпадали с «детектив», и такие
    // книги были недостижимы через жанр. Перечисляем авторов, которые в этом
    // каталоге пишут только криминальную прозу, и отдельные заголовки Рампо.
    exactTitles: [
      "Жертва подозреваемого X",
      "Человек-кресло",
      "Красная комната"
    ],
    exactAuthors: [
      "Дэшилл Хэммет",
      "Джеймс М. Кейн",
      "Джеймс Хэдли Чейз",
      "Корнелл Вулрич",
      "Ю Несбё",
      "Арнальдур Индридасон",
      "Карин Фоссум",
      "Джозеф Нокс",
      "Деннис Лихейн"
    ],
    exactThemes: ["детектив"],
    adjacentTitles: [],
    adjacentThemes: ["расследование", "преступление", "криминал"],
    adjacentVibes: [],
    stretchTitles: [],
    stretchThemes: [],
    stretchVibes: []
  },
  classic: {
    exactTitles: [
      "1984",
      "Скотный двор",
      "451 градус по Фаренгейту",
      "Три товарища",
      "Исповедь неполноценного человека",
      "Закатное солнце",
      "Кокоро",
      "Ваш покорный слуга кот",
      "Ворота Рассёмон",
      "В чаще",
      "Тысячекрылый журавль",
      "Стон горы",
      "Женщина в песках",
      "Золотой храм",
      "Жажда любви"
    ],
    exactAuthors: [
      "Джордж Оруэлл",
      "Рэй Брэдбери",
      "Эрих Мария Ремарк",
      "Осаму Дадзай",
      "Кобо Абэ",
      "Юкио Мисима",
      "Нацумэ Сосэки",
      "Рюноскэ Акутагава",
      "Ясунари Кавабата",
      // Русская классика и другие безусловно классические авторы каталога
      // раньше ловились только как обобщённый «Роман» и не попадали в ответ
      // «Классика». Каждый автор ниже представлен в каталоге только классикой.
      "Фёдор Достоевский",
      "Антон Чехов",
      "Иван Бунин",
      "Михаил Лермонтов",
      "Иван Тургенев",
      "Иван Гончаров",
      "Уильям Голдинг"
    ],
    adjacentTitles: ["Цветы для Элджернона", "Дюна"],
    adjacentThemes: ["свобода", "общество", "одиночество"]
  }
};

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

function matchesBookIdentity(book, candidates = []) {
  return (
    candidates.includes(book.title) ||
    candidates.includes(book.author) ||
    candidates.includes(`${book.title} — ${book.author}`)
  );
}

function getGenreMatchLevel(book, requestedGenre) {
  if (!requestedGenre || requestedGenre === "any") {
    return 0;
  }

  if (requestedGenre === "non-fiction") {
    return book.format === "нон-фикшн" ? 2 : -1;
  }

  if (requestedGenre === "fantasy") {
    return book.genre === "фэнтези" ? 2 : -1;
  }

  if (requestedGenre === "sci-fi") {
    return book.genre === "фантастика" ? 2 : -1;
  }

  const profile = structuredGenreProfiles[requestedGenre];

  if (profile) {
    if (
      matchesBookIdentity(book, profile.exactTitles || []) ||
      matchesBookIdentity(book, profile.exactAuthors || []) ||
      intersects(book.themes, profile.exactThemes || [])
    ) {
      return 2;
    }

    if (
      matchesBookIdentity(book, profile.adjacentTitles || []) ||
      intersects(book.themes, profile.adjacentThemes || []) ||
      intersects(book.vibe, profile.adjacentVibes || [])
    ) {
      return 1;
    }

    return -1;
  }

  if (requestedGenre === "novel") {
    return book.genre === "художественная литература" ? 2 : -1;
  }

  return matchesAny(book.genre, genreToLegacyGenreMap[requestedGenre]) ? 2 : -1;
}

function isStrongGenreMatch(book, preferences) {
  return getGenreMatchLevel(book, preferences.genre) >= 2;
}

function isGenreCompatible(book, preferences) {
  return getGenreMatchLevel(book, preferences.genre) >= 1;
}

function isStretchGenreCompatible(book, preferences) {
  const requestedGenre = preferences.genre;

  if (!requestedGenre || requestedGenre === "any") {
    return true;
  }

  if (isGenreCompatible(book, preferences)) {
    return true;
  }

  const profile = structuredGenreProfiles[requestedGenre];

  if (!profile) {
    return false;
  }

  return (
    matchesBookIdentity(book, profile.stretchTitles || []) ||
    intersects(book.themes, profile.stretchThemes || []) ||
    intersects(book.vibe, profile.stretchVibes || [])
  );
}

function scoreBook(book, preferences) {
  let score = 0;
  const genreMatchLevel = getGenreMatchLevel(book, preferences.genre);

  if (preferences.genre && preferences.genre !== "any") {
    if (genreMatchLevel >= 2) {
      score += 9;
    } else if (genreMatchLevel === 1) {
      score += 4;
    } else {
      score -= 4;
    }
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

  // Адаптивный тон — самый сильный вопрос системы, поэтому вес выше прочих.
  const toneP = toneProfile(preferences.tone);

  if (toneP) {
    if (toneP.vibes && intersects(book.vibe, toneP.vibes)) {
      score += 4;
    }

    if (toneP.moods && includesAny(book.mood, toneP.moods)) {
      score += 4;
    }
  }

  if (
    preferences.goal &&
    preferences.goal !== "random" &&
    preferences.goal !== "any" &&
    includesAny(book.goal, goalToLegacyGoalsMap[preferences.goal])
  ) {
    score += 3;
  }

  if (
    preferences.goal &&
    preferences.goal !== "random" &&
    preferences.goal !== "any" &&
    intersects(book.themes, goalToThemeMap[preferences.goal])
  ) {
    score += 2;
  }

  if (
    preferences.pace &&
    preferences.pace !== "any" &&
    normalizePace(book.pace) === normalizePace(preferences.pace)
  ) {
    score += 2;
  }

  if (
    preferences.pace &&
    preferences.pace !== "any" &&
    includesAny(book.mood, paceToLegacyMoodMap[normalizePace(preferences.pace)])
  ) {
    score += 1;
  }

  return score;
}

// Русские значения — наследие старого формата данных, схема их уже не
// пропускает, но остальной файл их всё ещё учитывает (см. isSlowPaced).
const complexityRanks = {
  low: 0,
  "простая": 0,
  medium: 1,
  "средняя": 1,
  high: 2,
  "сложная": 2
};

function getComplexityRank(book) {
  const rank = complexityRanks[book && book.complexity];
  return typeof rank === "number" ? rank : complexityRanks.medium;
}

function isHighComplexity(book) {
  return getComplexityRank(book) === complexityRanks.high;
}

// Карточка подписана «Более легкий вариант», поэтому safe не должен быть
// сложнее exact. Если такого кандидата нет вовсе, ограничение снимается —
// показать вариант важнее, чем оставить пользователя с одной книгой.
function isNotHarderThan(book, exact) {
  if (!exact) {
    return true;
  }

  return getComplexityRank(book) <= getComplexityRank(exact);
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

  if (toneFlag(preferences, "comfort") && intersects(vibes, cozySafeVibes)) {
    safeScore += 3;
  }

  if (toneFlag(preferences, "comfort") && intersects(vibes, cozyUnsafeVibes)) {
    safeScore -= 3;
  }

  if (intersects(vibes, difficultSafeVibes)) {
    safeScore -= 2;
  }

  if (book.complexity === "low") {
    safeScore += 1;
  }

  if (normalizePace(book.pace) === "fast") {
    safeScore += 1;
  }

  return safeScore;
}

function sortSafeCandidates(candidates, preferences) {
  return [...candidates].sort(
    (a, b) => getSafeScore(b, preferences) - getSafeScore(a, preferences)
  );
}

function hasDifferentTasteVector(book, exactBook, preferences) {
  if (!exactBook) {
    return true;
  }

  const differentGenre = book.genre !== exactBook.genre;
  const exactVibe = Array.isArray(exactBook.vibe) ? exactBook.vibe : [];
  const bookVibe = Array.isArray(book.vibe) ? book.vibe : [];
  const differentVibe = !bookVibe.some((vibe) => exactVibe.includes(vibe));

  if (preferences.genre && preferences.genre !== "any") {
    return differentVibe || getGenreMatchLevel(book, preferences.genre) === 1;
  }

  return differentGenre || differentVibe;
}

function createSelectionIndex(seed, page, salt, length) {
  if (!length) {
    return 0;
  }

  const normalizedSeed = Number.isFinite(seed) ? seed : 0;
  const normalizedPage = Number.isFinite(page) ? page : 0;
  return Math.abs(normalizedSeed + normalizedPage * 7 + salt * 13) % length;
}

function pickSeededUnique(
  candidates,
  usedIds,
  topLimit,
  seed,
  page,
  salt
) {
  const availableCandidates = candidates.filter((book) => {
    const id = createBookIdentity(book.title, book.author);
    return !usedIds.has(id);
  });
  const topCandidates = availableCandidates.slice(0, topLimit);

  if (!topCandidates.length) {
    return null;
  }

  return topCandidates[createSelectionIndex(seed, page, salt, topCandidates.length)];
}

function createSeededRandomGenerator(seed) {
  let state = (Number.isFinite(seed) ? seed : 0) + 1;

  return function nextRandom() {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

function shuffleBooksBySeed(bookList, seed) {
  const shuffled = [...bookList];
  const nextRandom = createSeededRandomGenerator(seed);

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(nextRandom() * (index + 1));
    const temp = shuffled[index];
    shuffled[index] = shuffled[swapIndex];
    shuffled[swapIndex] = temp;
  }

  return shuffled;
}

function buildUniqueRandomPool(bookList) {
  const uniqueBooks = new Map();

  for (const book of bookList) {
    const id = createBookIdentity(book.title, book.author);

    if (!uniqueBooks.has(id)) {
      uniqueBooks.set(id, book);
    }
  }

  return [...uniqueBooks.values()];
}

function expandCandidatePool(primaryCandidates, secondaryCandidates, minSize = 3) {
  const expanded = [...primaryCandidates];
  const existingIds = new Set(
    expanded.map((book) => createBookIdentity(book.title, book.author))
  );

  for (const candidate of secondaryCandidates) {
    const id = createBookIdentity(candidate.title, candidate.author);

    if (!existingIds.has(id)) {
      expanded.push(candidate);
      existingIds.add(id);
    }

    if (expanded.length >= minSize) {
      break;
    }
  }

  return expanded;
}

function buildRandomChainRecommendation(seed = 0, page = 0) {
  const pool = buildUniqueRandomPool(books);

  if (!pool.length) {
    return null;
  }

  const orderedPool = [...pool].sort((a, b) =>
    createBookIdentity(a.title, a.author).localeCompare(
      createBookIdentity(b.title, b.author)
    )
  );
  const shuffledPool = shuffleBooksBySeed(orderedPool, seed);

  if (page >= shuffledPool.length) {
    return null;
  }

  return shuffledPool[page];
}

function buildRoleRecommendations(preferences, options = {}) {
  const chainSeed = Number.isFinite(options.chainSeed) ? options.chainSeed : 0;
  const chainPage = Number.isFinite(options.chainPage) ? options.chainPage : 0;

  const scoredBooks = books
    .map((book) => ({
      ...book,
      score: scoreBook(book, preferences)
    }))
    .filter((book) => book.score > 0)
    .sort((a, b) => b.score - a.score);
  const strongGenreCandidates =
    preferences.genre && preferences.genre !== "any"
      ? scoredBooks.filter((book) => isStrongGenreMatch(book, preferences))
      : scoredBooks;
  const compatibleGenreCandidates =
    preferences.genre && preferences.genre !== "any"
      ? scoredBooks.filter((book) => isGenreCompatible(book, preferences))
      : scoredBooks;
  const exactCandidates =
    preferences.genre && preferences.genre !== "any"
      ? (strongGenreCandidates.length ? strongGenreCandidates : compatibleGenreCandidates)
      : scoredBooks;
  const genreSafeCandidates =
    preferences.genre && preferences.genre !== "any"
      ? expandCandidatePool(strongGenreCandidates, compatibleGenreCandidates, 4)
      : scoredBooks;
  const stretchCandidates = scoredBooks.filter(
    (book) =>
      book.score >= 2 &&
      !isHighComplexity(book) &&
      (
        !preferences.genre ||
        preferences.genre === "any" ||
        isStretchGenreCompatible(book, preferences)
      )
  );
  let currentPageRecommendations = {};
  const usedIds = new Set();

  for (let page = 0; page <= chainPage; page += 1) {
    const pageUsedIds = new Set(usedIds);
    const exact =
      pickSeededUnique(
        exactCandidates.length ? exactCandidates : scoredBooks,
        pageUsedIds,
        3,
        chainSeed,
        page,
        1
      ) || null;

    if (exact) {
      pageUsedIds.add(createBookIdentity(exact.title, exact.author));
    }

    const selectSafe = (allows) =>
      pickSeededUnique(
        sortSafeCandidates(
          genreSafeCandidates.filter(
            (book) =>
              book.score >= 3 && isSafeBook(book, preferences) && allows(book)
          ),
          preferences
        ),
        pageUsedIds,
        4,
        chainSeed,
        page,
        2
      ) ||
      pickSeededUnique(
        sortSafeCandidates(
          genreSafeCandidates.filter(
            (book) => isSafeBook(book, preferences) && allows(book)
          ),
          preferences
        ),
        pageUsedIds,
        4,
        chainSeed,
        page,
        3
      ) ||
      pickSeededUnique(
        sortSafeCandidates(
          scoredBooks.filter(
            (book) =>
              isSafeBook(book, preferences) &&
              isGenreCompatible(book, preferences) &&
              allows(book)
          ),
          preferences
        ),
        pageUsedIds,
        4,
        chainSeed,
        page,
        4
      ) ||
      null;

    const safe =
      selectSafe((book) => isNotHarderThan(book, exact)) ||
      selectSafe(() => true);

    if (safe) {
      pageUsedIds.add(createBookIdentity(safe.title, safe.author));
    }

    const filteredStretchCandidates = stretchCandidates.filter((book) =>
      hasDifferentTasteVector(book, exact, preferences)
    );
    const stretch =
      pickSeededUnique(
        filteredStretchCandidates,
        pageUsedIds,
        5,
        chainSeed,
        page,
        5
      ) ||
      pickSeededUnique(
        scoredBooks.filter(
          (book) =>
            (
              !preferences.genre ||
              preferences.genre === "any" ||
              isStretchGenreCompatible(book, preferences)
            ) && hasDifferentTasteVector(book, exact, preferences)
        ),
        pageUsedIds,
        5,
        chainSeed,
        page,
        6
      ) ||
      (
        preferences.genre && preferences.genre !== "any"
          ? null
          : pickSeededUnique(scoredBooks, pageUsedIds, 5, chainSeed, page, 7)
      ) ||
      null;

    currentPageRecommendations = {
      exact,
      safe,
      stretch
    };

    for (const role of recommendationRoles) {
      const book = currentPageRecommendations[role];

      if (book) {
        usedIds.add(createBookIdentity(book.title, book.author));
      }
    }
  }

  return currentPageRecommendations;
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
  const chainSeed = Number.isFinite(options.chainSeed) ? options.chainSeed : 0;
  const chainPage = Number.isFinite(options.chainPage) ? options.chainPage : 0;

  if (preferences.goal === "random") {
    const randomBook = buildRandomChainRecommendation(chainSeed, chainPage);

    return {
      roleRecommendations: randomBook ? { exact: randomBook, safe: null, stretch: null } : null,
      localRecommendations: randomBook ? [randomBook] : [],
      externalRecommendations: [],
      externalError: null,
      exhausted: !randomBook,
      exhaustedKind: "random"
    };
  }

  const roleRecommendations = buildRoleRecommendations(preferences, {
    chainSeed,
    chainPage
  });

  if (roleRecommendations.exact || roleRecommendations.safe || roleRecommendations.stretch) {
    return {
      roleRecommendations,
      localRecommendations: Object.values(roleRecommendations).filter(Boolean),
      externalRecommendations: [],
      externalError: null
    };
  }

  if (chainPage > 0) {
    return {
      roleRecommendations: null,
      localRecommendations: [],
      externalRecommendations: [],
      externalError: null,
      exhausted: true
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

// Обзор рекомендаций отправляется с parse_mode HTML (см. sendRecommendations),
// поэтому подставляемые названия, авторы и описания нужно экранировать.
function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildRecommendationMessage(preferences, recommendationSet) {
  if (recommendationSet.exhausted) {
    if (recommendationSet.exhaustedKind === "random") {
      return [
        "Кажется, я уже перебрала все случайные варианты на этот заход.",
        "Можно начать заново — тогда перемешаю книги по-новому."
      ].join("\n\n");
    }

    return "Похоже, я уже показала все подходящие варианты по этому запросу. Можно подобрать заново или вернуться в меню.";
  }

  if (recommendationSet.roleRecommendations) {
    const { exact, safe, stretch } = recommendationSet.roleRecommendations;
    // Тонкая линия-разделитель между тремя рекомендациями, чтобы обзор читался
    // как три отдельные карточки, а не сплошное полотно.
    const divider = "────────";
    const parts = [];

    const pushBook = (emoji, label, book) => {
      if (!book) {
        return;
      }

      parts.push(
        [
          `${emoji} <b>${escapeHtml(label)}</b>`,
          `<b>«${escapeHtml(book.title)}»</b> — ${escapeHtml(book.author)}`,
          escapeHtml(book.recommendationText || book.description),
        ].join("\n"),
      );
    };

    pushBook("📘", "Самое точное попадание", exact);
    pushBook("🌿", "Более легкий вариант", safe);
    pushBook("✨", "Вариант чуть в сторону", stretch);

    return ["Вот что я бы предложила:", parts.join(`\n\n${divider}\n\n`)].join(
      "\n\n",
    );
  }

  const { localRecommendations, externalRecommendations, externalError } =
    recommendationSet;
  const hasRecommendations =
    localRecommendations.length > 0 || externalRecommendations.length > 0;

  if (!hasRecommendations) {
    return "Пока не получилось найти хороший вариант под эти параметры. Попробуй изменить один из них или начать подбор заново.";
  }

  const summary = [
    "Вот что я бы порекомендовала:",
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
              `${index + 1}. ${escapeHtml(book.title)} — ${escapeHtml(
                book.author,
              )}\n${escapeHtml(book.recommendationText || book.description)}`
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
              `${index + 1}. ${escapeHtml(book.title)} — ${escapeHtml(
                book.author,
              )}\n${escapeHtml(book.recommendationText)}`
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
  buildFindBooksMessage,
  structuredGenreProfiles,
  goalToLegacyGoalsMap,
  toneCatalog,
  getGenreMatchLevel
};
