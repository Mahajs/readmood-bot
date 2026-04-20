const GOOGLE_BOOKS_SEARCH_URL = "https://www.googleapis.com/books/v1/volumes";

const genreKeywords = {
  "художественная литература": ["subject:fiction", "intitle:roman"],
  фантастика: ["subject:science fiction"],
  фэнтези: ["subject:fantasy"],
  психология: ["subject:psychology"],
  история: ["subject:history"],
  саморазвитие: ["subject:self-help"],
  продуктивность: ["subject:productivity", "subject:time management"]
};

const moodKeywords = {
  легкое: ["subject:humor"],
  вдумчивое: ["subject:philosophy"],
  эмоциональное: ["subject:relationships"],
  практичное: ["subject:practical"],
  приключенческое: ["subject:adventure"],
  мотивирующее: ["subject:motivation"],
  мрачное: ["subject:dystopia"],
  обнадеживающее: ["subject:hope"]
};

const goalKeywords = {
  отдохнуть: ["subject:bestsellers"],
  "узнать новое": ["subject:introduction"],
  подумать: ["subject:ideas"],
  вдохновиться: ["subject:inspiration"],
  "погрузиться в мир": ["subject:fiction"],
  "стать эффективнее": ["subject:habits", "subject:productivity"]
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
    parts.add("subject:fiction");
  }

  if (preferences.format === "нон-фикшн") {
    parts.add("-subject:fiction");
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
  const data = await fetchGoogleBooks({
    q: trimmedQuery,
    langRestrict: "ru",
    printType: "books",
    orderBy: "relevance",
    projection: "lite",
    maxResults: String(limit)
  });

  return (data.items || []).map((item) => mapGoogleBook(item));
}

module.exports = {
  searchGoogleBooks,
  searchGoogleBooksByText,
  createBookIdentity
};
