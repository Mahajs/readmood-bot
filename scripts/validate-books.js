#!/usr/bin/env node

const path = require("path");
const { books } = require(path.join(__dirname, "../src/data/books"));

const requiredFields = [
  "title",
  "author",
  "genre",
  "mood",
  "format",
  "length",
  "goal",
  "description",
  "recommendationText",
  "vibe",
  "themes",
  "pace",
  "complexity",
];

const allowedGenres = new Set([
  "художественная литература",
  "фэнтези",
  "фантастика",
  "психология",
  "история",
  "саморазвитие",
  "продуктивность",
]);

const allowedPaces = new Set(["slow", "medium", "fast", "very_fast"]);
const allowedComplexities = new Set(["low", "medium", "high"]);

function isBlank(value) {
  return typeof value === "string" && value.trim() === "";
}

function isEmpty(value) {
  if (value === null || value === undefined) {
    return true;
  }

  if (typeof value === "string") {
    return value.trim() === "";
  }

  if (Array.isArray(value)) {
    return value.length === 0;
  }

  return false;
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ")
    .trim();
}

function formatBookLabel(book, index) {
  const title = book && book.title ? ` "${book.title}"` : "";

  return `Книга #${index + 1}${title}`;
}

function addError(errorsByBook, index, message) {
  if (!errorsByBook.has(index)) {
    errorsByBook.set(index, []);
  }

  errorsByBook.get(index).push(message);
}

function validateRequiredFields(book, index, errorsByBook) {
  for (const field of requiredFields) {
    if (isEmpty(book[field])) {
      addError(errorsByBook, index, `отсутствует или пустое поле ${field}`);
    }
  }
}

function validateFieldTypes(book, index, errorsByBook) {
  if (book.vibe !== undefined && !Array.isArray(book.vibe)) {
    addError(errorsByBook, index, "vibe должен быть массивом");
  }

  if (book.themes !== undefined && !Array.isArray(book.themes)) {
    addError(errorsByBook, index, "themes должен быть массивом");
  }

  if (book.pace !== undefined && typeof book.pace !== "string") {
    addError(errorsByBook, index, "pace должен быть строкой");
  }

  if (book.complexity !== undefined && typeof book.complexity !== "string") {
    addError(errorsByBook, index, "complexity должен быть строкой");
  }
}

function validateAllowedValues(book, index, errorsByBook) {
  if (typeof book.genre === "string" && !allowedGenres.has(book.genre)) {
    addError(errorsByBook, index, `недопустимый genre: ${book.genre}`);
  }

  if (typeof book.pace === "string" && !allowedPaces.has(book.pace)) {
    addError(errorsByBook, index, `недопустимый pace: ${book.pace}`);
  }

  if (
    typeof book.complexity === "string" &&
    !allowedComplexities.has(book.complexity)
  ) {
    addError(errorsByBook, index, `недопустимый complexity: ${book.complexity}`);
  }
}

function validateThemeQuality(book, index, errorsByBook) {
  if (!Array.isArray(book.themes)) {
    return;
  }

  const seenThemes = new Set();

  book.themes.forEach((theme, themeIndex) => {
    const label = `theme #${themeIndex + 1}`;

    if (typeof theme !== "string") {
      addError(errorsByBook, index, `${label} должен быть строкой`);
      return;
    }

    if (isBlank(theme)) {
      addError(errorsByBook, index, `${label} пустой`);
      return;
    }

    const trimmedTheme = theme.trim();
    const normalizedTheme = normalizeText(trimmedTheme);

    if (theme !== trimmedTheme) {
      addError(errorsByBook, index, `theme "${theme}" содержит лишние пробелы`);
    }

    if (trimmedTheme.length > 40) {
      addError(
        errorsByBook,
        index,
        `слишком длинный theme-тег: "${trimmedTheme}"`,
      );
    }

    if (trimmedTheme.split(/\s+/).length > 4) {
      addError(errorsByBook, index, `слишком многословный theme-тег: "${trimmedTheme}"`);
    }

    if (/https?:\/\/|www\.|@/.test(trimmedTheme)) {
      addError(errorsByBook, index, `странный theme-тег: "${trimmedTheme}"`);
    }

    if (seenThemes.has(normalizedTheme)) {
      addError(errorsByBook, index, `дублирующийся theme-тег: "${trimmedTheme}"`);
    }

    seenThemes.add(normalizedTheme);
  });
}

function validateTextQuality(book, index, errorsByBook) {
  for (const field of ["title", "author", "description", "recommendationText"]) {
    if (typeof book[field] === "string" && book[field] !== book[field].trim()) {
      addError(errorsByBook, index, `${field} содержит лишние пробелы по краям`);
    }
  }
}

function findDuplicates(bookList, errorsByBook) {
  const seenBooks = new Map();

  bookList.forEach((book, index) => {
    const key = `${normalizeText(book.title)}::${normalizeText(book.author)}`;

    if (!normalizeText(book.title) || !normalizeText(book.author)) {
      return;
    }

    if (seenBooks.has(key)) {
      const firstIndex = seenBooks.get(key);

      addError(
        errorsByBook,
        index,
        `дубликат title + author с книгой #${firstIndex + 1}`,
      );
      addError(
        errorsByBook,
        firstIndex,
        `дубликат title + author с книгой #${index + 1}`,
      );
      return;
    }

    seenBooks.set(key, index);
  });
}

function validateBooks(bookList) {
  const errorsByBook = new Map();

  if (!Array.isArray(bookList)) {
    return {
      fatalError: "src/data/books.js должен экспортировать массив books",
      errorsByBook,
    };
  }

  bookList.forEach((book, index) => {
    if (!book || typeof book !== "object" || Array.isArray(book)) {
      addError(errorsByBook, index, "запись книги должна быть объектом");
      return;
    }

    validateRequiredFields(book, index, errorsByBook);
    validateFieldTypes(book, index, errorsByBook);
    validateAllowedValues(book, index, errorsByBook);
    validateThemeQuality(book, index, errorsByBook);
    validateTextQuality(book, index, errorsByBook);
  });

  findDuplicates(bookList, errorsByBook);

  return { errorsByBook };
}

function printValidationResult(bookList, result) {
  if (result.fatalError) {
    console.error(`❌ ${result.fatalError}`);
    return;
  }

  if (result.errorsByBook.size === 0) {
    console.log(`✅ books.js валиден. Проверено книг: ${bookList.length}.`);
    return;
  }

  console.error(`❌ books.js содержит ошибки. Проверено книг: ${bookList.length}.`);

  for (const [index, messages] of result.errorsByBook.entries()) {
    console.error(`\n❌ ${formatBookLabel(bookList[index], index)}`);

    for (const message of messages) {
      console.error(`* ${message}`);
    }
  }
}

const result = validateBooks(books);
printValidationResult(books, result);

if (result.fatalError || result.errorsByBook.size > 0) {
  process.exitCode = 1;
}
