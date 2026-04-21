const GOOGLE_BOOKS_SEARCH_URL = "https://www.googleapis.com/books/v1/volumes";

const genreKeywords = {
  "художественная литература": ["subject:fiction", "intitle:roman"],
  фантастика: ["subject:science fiction"],
  фэнтези: ["subject:fantasy"],
  психология: ["subject:psychology"],
  история: ["subject:history"],
  саморазвитие: ["subject:self-help"],
  продуктивность: ["subject:productivity", "subject:time management"],
  novel: ["subject:fiction", "intitle:roman"],
  detective: ["subject:detective"],
  fantasy: ["subject:fantasy"],
  "sci-fi": ["subject:science fiction"],
  "non-fiction": ["subject:nonfiction"],
  contemporary: ["subject:fiction"],
  classic: ["subject:classic"]
};

const moodKeywords = {
  легкое: ["subject:humor"],
  вдумчивое: ["subject:philosophy"],
  эмоциональное: ["subject:relationships"],
  практичное: ["subject:practical"],
  приключенческое: ["subject:adventure"],
  мотивирующее: ["subject:motivation"],
  мрачное: ["subject:dystopia"],
  обнадеживающее: ["subject:hope"],
  cozy: ["subject:family"],
  tense: ["subject:thriller"],
  light: ["subject:humor"],
  melancholic: ["subject:relationships"],
  mysterious: ["subject:mystery"]
};

const goalKeywords = {
  отдохнуть: ["subject:bestsellers"],
  "узнать новое": ["subject:introduction"],
  подумать: ["subject:ideas"],
  вдохновиться: ["subject:inspiration"],
  "погрузиться в мир": ["subject:fiction"],
  "стать эффективнее": ["subject:habits", "subject:productivity"],
  relax: ["subject:bestsellers"],
  inspire: ["subject:inspiration"],
  emotional: ["subject:relationships"],
  reflective: ["subject:ideas"],
  escape: ["subject:fiction"],
  dynamic: ["subject:adventure"]
};

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

function countQueryWordsMatch(query, ...values) {
  const words = normalizeText(query).split(" ").filter(Boolean);
  const haystack = normalizeText(values.join(" "));

  return words.filter((word) => haystack.includes(word)).length;
}

function looksLikeAuthorQuery(query) {
  const words = normalizeText(query).split(" ").filter(Boolean);
  return words.length >= 2;
}

function buildSearchQuery(preferences) {
  const parts = new Set();

  for (const keyword of genreKeywords[preferences.genre] || []) {
    parts.add(keyword);
  }

  for (const keyword of moodKeywords[preferences.mood] || []) {
    parts.add(keyword);
  }

  for (const keyword of moodKeywords[preferences.vibe] || []) {
    parts.add(keyword);
  }

  for (const keyword of goalKeywords[preferences.goal] || []) {
    parts.add(keyword);
  }

  if (preferences.format === "художественная") {
    parts.add("subject:fiction");
  }

  if (preferences.format === "нон-фикшн") {
    parts.add("-subject:fiction");
  }

  if (preferences.genre === "non-fiction") {
    parts.add("subject:nonfiction");
  }

  return Array.from(parts).join(" ");
}

function ensureApiKey() {
  const apiKey = process.env.GOOGLE_BOOKS_API_KEY;

  if (!apiKey) {
    throw new Error("Missing GOOGLE_BOOKS_API_KEY");
  }

  return apiKey;
}

function mapGoogleBook(item, recommendationText) {
  const info = item.volumeInfo || {};
  const title = info.title || "Без названия";
  const author = info.authors?.[0] || "Автор не указан";
  const publishedDate = info.publishedDate
    ? `Издание: ${info.publishedDate}.`
    : "";

  return {
    title,
    author,
    source: "google-books",
    googleBooksId: item.id || null,
    infoLink: info.infoLink || null,
    thumbnail:
      info.imageLinks?.thumbnail || info.imageLinks?.smallThumbnail || null,
    recommendationText:
      recommendationText || publishedDate || "Найдено во внешней базе Google Books."
  };
}

function scoreGoogleBook(item, query) {
  const info = item.volumeInfo || {};
  const title = info.title || "";
  const subtitle = info.subtitle || "";
  const authors = Array.isArray(info.authors) ? info.authors.join(" ") : "";
  const categories = Array.isArray(info.categories) ? info.categories.join(" ") : "";
  const description = info.description || "";
  const normalizedQuery = normalizeText(query);
  let score = 0;

  if (normalizeText(title).includes(normalizedQuery)) {
    score += 12;
  }

  if (normalizeText(subtitle).includes(normalizedQuery)) {
    score += 6;
  }

  if (normalizeText(authors).includes(normalizedQuery)) {
    score += 14;
  }

  score += countQueryWordsMatch(query, title, subtitle, authors) * 3;
  score += countQueryWordsMatch(query, categories, description);

  if (looksLikeAuthorQuery(query) && normalizeText(authors).includes(normalizedQuery)) {
    score += 10;
  }

  if (
    looksLikeAuthorQuery(query) &&
    !normalizeText(authors).includes(normalizedQuery) &&
    countQueryWordsMatch(query, authors) === 0
  ) {
    score -= 8;
  }

  return score;
}

async function fetchGoogleBooks(params) {
  const apiKey = ensureApiKey();
  const query = new URLSearchParams({ ...params, key: apiKey });
  const response = await fetch(`${GOOGLE_BOOKS_SEARCH_URL}?${query.toString()}`);

  if (!response.ok) {
    throw new Error(`Google Books request failed with status ${response.status}`);
  }

  return response.json();
}

async function searchGoogleBooks(preferences, options = {}) {
  const query = buildSearchQuery(preferences);

  if (!query) {
    return [];
  }

  const limit = Math.min(options.limit || 5, 40);
  const data = await fetchGoogleBooks({
    q: query,
    langRestrict: "ru",
    printType: "books",
    orderBy: "relevance",
    projection: "lite",
    maxResults: String(limit)
  });

  return (data.items || []).map((item) =>
    mapGoogleBook(item, "Нашел во внешней базе Google Books по твоим параметрам.")
  );
}

async function searchGoogleBooksByText(query, options = {}) {
  const trimmedQuery = String(query || "").trim();

  if (!trimmedQuery) {
    return [];
  }

  const limit = Math.min(options.limit || 5, 40);
  const searchQuery = looksLikeAuthorQuery(trimmedQuery)
    ? `inauthor:${trimmedQuery}`
    : trimmedQuery;
  const data = await fetchGoogleBooks({
    q: searchQuery,
    langRestrict: "ru",
    printType: "books",
    orderBy: "relevance",
    projection: "lite",
    maxResults: String(limit * 3)
  });

  return (data.items || [])
    .map((item) => ({
      item,
      score: scoreGoogleBook(item, trimmedQuery)
    }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ item }) => mapGoogleBook(item));
}

module.exports = {
  searchGoogleBooks,
  searchGoogleBooksByText,
  createBookIdentity
};
