const OPEN_LIBRARY_SEARCH_URL = "https://openlibrary.org/search.json";

const genreKeywords = {
  "художественная литература": ["novel", "literature"],
  фантастика: ["science fiction"],
  фэнтези: ["fantasy"],
  психология: ["psychology"],
  история: ["history"],
  саморазвитие: ["self help"],
  продуктивность: ["productivity", "time management"]
};

const moodKeywords = {
  легкое: ["uplifting", "humor"],
  вдумчивое: ["philosophical", "thoughtful"],
  эмоциональное: ["emotional", "relationships"],
  практичное: ["practical"],
  приключенческое: ["adventure"],
  мотивирующее: ["motivation"],
  мрачное: ["dystopia", "dark"],
  обнадеживающее: ["hope"],
  любознательное: ["ideas"],
  сосредоточенное: ["focus"]
};

const goalKeywords = {
  отдохнуть: ["engaging", "popular"],
  "узнать новое": ["introduction", "guide"],
  подумать: ["classic", "ideas"],
  вдохновиться: ["inspiring"],
  "погрузиться в мир": ["immersive"],
  "стать эффективнее": ["habits", "productivity"]
};

function buildSearchQuery(preferences) {
  const parts = new Set();

  for (const keyword of genreKeywords[preferences.genre] || []) {
    parts.add(keyword);
  }

  for (const keyword of moodKeywords[preferences.mood] || []) {
    parts.add(keyword);
  }

  for (const keyword of goalKeywords[preferences.goal] || []) {
    parts.add(keyword);
  }

  if (preferences.format === "художественная") {
    parts.add("novel");
  }

  if (preferences.format === "нон-фикшн") {
    parts.add("nonfiction");
  }

  return Array.from(parts).join(" ");
}

function buildUserAgent() {
  const contact = process.env.OPEN_LIBRARY_CONTACT_EMAIL;

  if (contact) {
    return `ReadMoodBot/1.0 (${contact})`;
  }

  return "ReadMoodBot/1.0";
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9]+/gi, " ")
    .trim();
}

function createBookIdentity(title, author) {
  return `${normalizeText(title)}::${normalizeText(author)}`;
}

function hasCyrillic(value) {
  return /[а-яё]/i.test(String(value || ""));
}

function hasLatin(value) {
  return /[a-z]/i.test(String(value || ""));
}

function hasOtherScript(value) {
  return /[^\s\da-zа-яё.,:;!?'"()\-]/i.test(String(value || ""));
}

function getReadableScriptScore(text, queryHasCyrillic) {
  const value = String(text || "");

  if (queryHasCyrillic) {
    if (hasCyrillic(value)) {
      return 5;
    }

    if (hasLatin(value)) {
      return 2;
    }

    if (hasOtherScript(value)) {
      return -6;
    }

    return 0;
  }

  if (hasLatin(value)) {
    return 4;
  }

  if (hasCyrillic(value)) {
    return 2;
  }

  if (hasOtherScript(value)) {
    return -4;
  }

  return 0;
}

function scoreSearchResult(doc, query) {
  const normalizedQuery = normalizeText(query);
  const normalizedTitle = normalizeText(doc.title);
  const normalizedAuthor = normalizeText(doc.author_name?.[0]);
  const queryHasCyrillic = hasCyrillic(query);
  const languages = Array.isArray(doc.language) ? doc.language : [];
  let score = 0;

  if (normalizedTitle.includes(normalizedQuery)) {
    score += 10;
  }

  if (normalizedAuthor.includes(normalizedQuery)) {
    score += 8;
  }

  const queryWords = normalizedQuery.split(" ").filter(Boolean);
  const combined = `${normalizedTitle} ${normalizedAuthor}`.trim();
  const matchingWords = queryWords.filter((word) => combined.includes(word)).length;
  score += matchingWords * 2;

  score += getReadableScriptScore(doc.title, queryHasCyrillic);
  score += getReadableScriptScore(doc.author_name?.[0], queryHasCyrillic);

  if (languages.includes("rus")) {
    score += 5;
  }

  if (languages.includes("eng")) {
    score += 2;
  }

  if (
    hasOtherScript(doc.title) &&
    !hasCyrillic(doc.title) &&
    !hasLatin(doc.title) &&
    hasOtherScript(doc.author_name?.[0]) &&
    !hasCyrillic(doc.author_name?.[0]) &&
    !hasLatin(doc.author_name?.[0])
  ) {
    score -= 8;
  }

  return score;
}

function mapOpenLibraryBook(doc, preferences) {
  const title = doc.title || "Без названия";
  const author = doc.author_name?.[0] || "Автор не указан";
  const year = doc.first_publish_year ? ` Первое издание: ${doc.first_publish_year}.` : "";
  const coverUrl = doc.cover_i
    ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg`
    : null;

  return {
    title,
    author,
    source: "openlibrary",
    coverUrl,
    openLibraryKey: doc.key || null,
    recommendationText:
      `Нашел во внешней базе Open Library по твоим параметрам.${year}`.trim()
  };
}

function mapOpenLibrarySearchResult(doc) {
  const title = doc.title || "Без названия";
  const author = doc.author_name?.[0] || "Автор не указан";
  const year = doc.first_publish_year ? `Первое издание: ${doc.first_publish_year}.` : "";

  return {
    title,
    author,
    source: "openlibrary",
    openLibraryKey: doc.key || null,
    recommendationText: year || "Найдено во внешней базе Open Library."
  };
}

function looksLikeAuthorQuery(query) {
  const words = String(query || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  return words.length >= 2;
}

function formatSearchResult(doc, query) {
  const mapped = mapOpenLibrarySearchResult(doc);
  const originalAuthor = mapped.author;
  const queryHasCyrillic = hasCyrillic(query);
  const authorUsesOnlyOtherScript =
    hasOtherScript(originalAuthor) &&
    !hasCyrillic(originalAuthor) &&
    !hasLatin(originalAuthor);

  if (queryHasCyrillic && authorUsesOnlyOtherScript && looksLikeAuthorQuery(query)) {
    return {
      ...mapped,
      author: query,
      recommendationText: [
        `Автор в базе указан как: ${originalAuthor}.`,
        mapped.recommendationText
      ].join(" ")
    };
  }

  return mapped;
}

async function searchOpenLibrary(preferences, options = {}) {
  const query = buildSearchQuery(preferences);

  if (!query) {
    return [];
  }

  const limit = options.limit || 5;
  const params = new URLSearchParams({
    q: query,
    lang: "ru",
    limit: String(limit),
    fields: "key,title,author_name,first_publish_year,cover_i"
  });

  const response = await fetch(`${OPEN_LIBRARY_SEARCH_URL}?${params.toString()}`, {
    headers: {
      "User-Agent": buildUserAgent()
    }
  });

  if (!response.ok) {
    throw new Error(`Open Library request failed with status ${response.status}`);
  }

  const data = await response.json();
  return (data.docs || []).map((doc) => mapOpenLibraryBook(doc, preferences));
}

async function searchOpenLibraryByText(query, options = {}) {
  const trimmedQuery = String(query || "").trim();

  if (!trimmedQuery) {
    return [];
  }

  const limit = options.limit || 5;
  const params = new URLSearchParams({
    q: trimmedQuery,
    lang: "ru",
    limit: String(limit),
    fields: "key,title,author_name,first_publish_year,language"
  });

  const response = await fetch(`${OPEN_LIBRARY_SEARCH_URL}?${params.toString()}`, {
    headers: {
      "User-Agent": buildUserAgent()
    }
  });

  if (!response.ok) {
    throw new Error(`Open Library request failed with status ${response.status}`);
  }

  const data = await response.json();
  const rankedResults = (data.docs || [])
    .map((doc) => ({
      doc,
      score: scoreSearchResult(doc, trimmedQuery)
    }))
    .sort((a, b) => b.score - a.score);

  const filteredResults = rankedResults.filter((item) => item.score > -2);
  const finalResults =
    filteredResults.length > 0 ? filteredResults : rankedResults.slice(0, limit);

  return finalResults.map(({ doc }) => formatSearchResult(doc, trimmedQuery));
}

module.exports = {
  searchOpenLibraryByText,
  searchOpenLibrary,
  createBookIdentity
};
