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

function scoreBook(book, preferences) {
  let score = 0;

  if (preferences.genre && book.genre === preferences.genre) {
    score += 4;
  }

  if (preferences.format && book.format === preferences.format) {
    score += 3;
  }

  if (preferences.length && book.length === preferences.length) {
    score += 2;
  }

  if (preferences.mood && book.mood.includes(preferences.mood)) {
    score += 3;
  }

  if (preferences.goal && book.goal.includes(preferences.goal)) {
    score += 3;
  }

  return score;
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
        [book.title, book.author, book.description, book.recommendationText].join(" ")
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
  const { localRecommendations, externalRecommendations, externalError } =
    recommendationSet;
  const hasRecommendations =
    localRecommendations.length > 0 || externalRecommendations.length > 0;

  if (!hasRecommendations) {
    return [
      "Пока не нашлось точного совпадения по выбранным параметрам.",
      "Попробуй изменить жанр, настроение или длину книги командой /restart."
    ].join("\n");
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
      "Внешняя база Google Books сейчас временно недоступна, поэтому показаны только локальные рекомендации."
    );
  }

  return `${summary}\n\n${blocks.join("\n\n")}`;
}

function buildFindBooksMessage(query, searchResult) {
  const { localResults, externalResults, externalError } = searchResult;
  const hasResults = localResults.length > 0 || externalResults.length > 0;

  if (!hasResults) {
    return `По запросу "${query}" ничего не нашлось. Попробуй другое название книги или фамилию автора.`;
  }

  const blocks = [`Вот что я нашел по запросу "${query}":`];

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
      "Google Books сейчас временно недоступна, поэтому показаны только локальные результаты."
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
