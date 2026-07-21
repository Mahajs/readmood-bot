const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const path = require("node:path");

const { books } = require("../src/data/books");
const {
  requiredBookFields,
  allowedBookGenres,
  allowedBookPaces,
  allowedBookComplexities,
} = require("../src/data/bookSchema");
const { structuredGenreProfiles } = require("../src/services/recommender");

const rootDir = path.join(__dirname, "..");

test("каталог не пуст", () => {
  assert.ok(Array.isArray(books));
  assert.ok(books.length > 0);
});

test("у каждой книги есть все обязательные поля", () => {
  for (const book of books) {
    for (const field of requiredBookFields) {
      const value = book[field];
      const isEmpty =
        value === null ||
        value === undefined ||
        (typeof value === "string" && value.trim() === "") ||
        (Array.isArray(value) && value.length === 0);

      assert.ok(
        !isEmpty,
        `«${book.title}»: пустое обязательное поле "${field}"`,
      );
    }
  }
});

test("genre, pace и complexity — только из разрешённых значений", () => {
  for (const book of books) {
    assert.ok(
      allowedBookGenres.includes(book.genre),
      `«${book.title}»: неизвестный genre "${book.genre}"`,
    );
    assert.ok(
      allowedBookPaces.includes(book.pace),
      `«${book.title}»: неизвестный pace "${book.pace}"`,
    );
    assert.ok(
      allowedBookComplexities.includes(book.complexity),
      `«${book.title}»: неизвестный complexity "${book.complexity}"`,
    );
  }
});

test("нет дублей по title + author", () => {
  const seen = new Map();

  for (const book of books) {
    const key = `${book.title}::${book.author}`.toLowerCase();
    assert.ok(!seen.has(key), `дубликат: «${book.title}» — ${book.author}`);
    seen.set(key, true);
  }
});

// Регрессия: structuredGenreProfiles матчит книги по строковому названию и
// автору, поэтому переименование в books.js молча выключает правило. Именно так
// выпали «Ворота Рассёмон» и «Магазин чудес "Намия"».
test("правила подбора ссылаются только на существующие книги", () => {
  const titles = new Set(books.map((book) => book.title));
  const authors = new Set(books.map((book) => book.author));

  for (const [genre, profile] of Object.entries(structuredGenreProfiles)) {
    for (const field of ["exactTitles", "adjacentTitles", "stretchTitles"]) {
      for (const title of profile[field] || []) {
        assert.ok(
          titles.has(title),
          `${genre}.${field}: книги "${title}" нет в books.js`,
        );
      }
    }

    for (const author of profile.exactAuthors || []) {
      assert.ok(
        authors.has(author),
        `${genre}.exactAuthors: автора "${author}" нет в books.js`,
      );
    }
  }
});

test("обложки указывают на реальные файлы в public/covers", () => {
  const fs = require("node:fs");

  for (const book of books) {
    if (!book.cover) {
      continue;
    }

    const coverPath = path.join(rootDir, "public", book.cover);
    assert.ok(
      fs.existsSync(coverPath),
      `«${book.title}»: обложка ${book.cover} не найдена на диске`,
    );
  }
});

test("npm run validate-books завершается успешно", () => {
  const output = execFileSync(
    process.execPath,
    [path.join(rootDir, "scripts", "validate-books.js")],
    { encoding: "utf8" },
  );

  assert.match(output, /валиден/);
});
