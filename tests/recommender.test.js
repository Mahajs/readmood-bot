const test = require("node:test");
const assert = require("node:assert/strict");

const {
  recommendBooks,
  findLocalBooks,
  buildRecommendationMessage,
  goalToLegacyGoalsMap,
} = require("../src/services/recommender");
const { books } = require("../src/data/books");

const goals = [
  "relax",
  "inspire",
  "emotional",
  "reflective",
  "escape",
  "dynamic",
];
const vibes = ["cozy", "tense", "light", "melancholic", "mysterious", "any"];
const genres = [
  "novel",
  "detective",
  "fantasy",
  "sci-fi",
  "non-fiction",
  "contemporary",
  "classic",
  "any",
];
// "very_fast" больше не отдельный вариант ответа — он слит с "fast".
const paces = ["slow", "medium", "fast", "any"];
const lengths = ["short", "medium", "long", "any"];

function everyCombination() {
  const combinations = [];

  for (const goal of goals) {
    for (const vibe of vibes) {
      for (const genre of genres) {
        for (const pace of paces) {
          for (const length of lengths) {
            combinations.push({ goal, vibe, genre, pace, length });
          }
        }
      }
    }
  }

  return combinations;
}

// Полный перебор опроса: ни одно сочетание ответов не должно падать или
// оставлять пользователя без «точного попадания».
test("любое сочетание ответов даёт рекомендацию", async () => {
  const combinations = everyCombination();
  const failures = [];

  for (const preferences of combinations) {
    let result;

    try {
      result = await recommendBooks(preferences, {
        chainSeed: 1,
        chainPage: 0,
        skipExternal: true,
      });
    } catch (error) {
      failures.push(`${JSON.stringify(preferences)} → ${error.message}`);
      continue;
    }

    if (!result.roleRecommendations || !result.roleRecommendations.exact) {
      failures.push(`${JSON.stringify(preferences)} → нет exact`);
    }
  }

  assert.deepEqual(failures.slice(0, 5), []);
  assert.equal(combinations.length, 4608);
});

test("выбранный жанр всегда соблюдается в «точном попадании»", async () => {
  const genreChecks = {
    fantasy: (book) => book.genre === "фэнтези",
    "sci-fi": (book) => book.genre === "фантастика",
    "non-fiction": (book) => book.format === "нон-фикшн",
    novel: (book) => book.genre === "художественная литература",
  };

  for (const [genre, matches] of Object.entries(genreChecks)) {
    const result = await recommendBooks(
      { goal: "relax", vibe: "any", genre, pace: "any", length: "any" },
      { chainSeed: 1, chainPage: 0, skipExternal: true },
    );
    const exact = result.roleRecommendations.exact;

    assert.ok(
      matches(exact),
      `жанр "${genre}" вернул «${exact.title}» (genre=${exact.genre}, format=${exact.format})`,
    );
  }
});

// Регрессия: обе книги есть в каталоге, но правила ссылались на их старые
// названия, поэтому в свой жанр они не попадали.
test("переименованные книги снова попадают в свои жанры", async () => {
  const cases = [
    { title: "Ворота Рассёмон", genre: "classic" },
    { title: 'Магазин чудес "Намия"', genre: "contemporary" },
  ];

  for (const { title, genre } of cases) {
    assert.ok(
      books.some((book) => book.title === title),
      `«${title}» пропала из каталога — обнови правило подбора`,
    );

    const found = await recommendBooks(
      { goal: "reflective", vibe: "any", genre, pace: "any", length: "any" },
      { chainSeed: 1, chainPage: 0, skipExternal: true },
    );

    assert.ok(found.roleRecommendations.exact);
  }
});

test("цепочка «Еще варианты» не повторяет книги", async () => {
  const preferences = {
    goal: "escape",
    vibe: "any",
    genre: "any",
    pace: "any",
    length: "any",
  };
  const seen = new Set();

  for (let page = 0; page < 5; page++) {
    const result = await recommendBooks(preferences, {
      chainSeed: 42,
      chainPage: page,
      skipExternal: true,
    });
    const roles = result.roleRecommendations || {};

    for (const role of ["exact", "safe", "stretch"]) {
      const book = roles[role];

      if (!book) {
        continue;
      }

      const key = `${book.title}::${book.author}`;
      assert.ok(!seen.has(key), `«${book.title}» повторилась на странице ${page}`);
      seen.add(key);
    }
  }
});

test("один и тот же seed даёт один и тот же результат", async () => {
  const preferences = {
    goal: "relax",
    vibe: "cozy",
    genre: "any",
    pace: "any",
    length: "any",
  };
  const options = { chainSeed: 7, chainPage: 2, skipExternal: true };

  const first = await recommendBooks(preferences, options);
  const second = await recommendBooks(preferences, options);

  assert.equal(
    first.roleRecommendations.exact.title,
    second.roleRecommendations.exact.title,
  );
});

test("случайный режим не повторяется внутри цепочки", async () => {
  const preferences = { goal: "random" };
  const seen = new Set();

  for (let page = 0; page < 10; page++) {
    const result = await recommendBooks(preferences, {
      chainSeed: 99,
      chainPage: page,
      skipExternal: true,
    });
    const book = result.roleRecommendations && result.roleRecommendations.exact;

    if (!book) {
      continue;
    }

    assert.ok(!seen.has(book.title), `«${book.title}» повторилась на шаге ${page}`);
    seen.add(book.title);
  }

  assert.ok(seen.size > 0);
});

test("поиск по каталогу находит по названию и по автору", () => {
  const byTitle = findLocalBooks("1984");
  assert.ok(byTitle.some((book) => book.title === "1984"));

  const byAuthor = findLocalBooks("Оруэлл");
  assert.ok(byAuthor.every((book) => book.score > 0));
  assert.ok(byAuthor.some((book) => /Оруэлл/.test(book.author)));

  assert.deepEqual(findLocalBooks(""), []);
});

// recommendationText не заполнен ни у одной локальной книги, поэтому карточки
// держатся на фолбэке в description. Если фолбэк сломать — тексты исчезнут.
test("карточка книги не остаётся без текста", async () => {
  const preferences = {
    goal: "relax",
    vibe: "any",
    genre: "any",
    pace: "any",
    length: "any",
  };
  const result = await recommendBooks(preferences, {
    chainSeed: 1,
    chainPage: 0,
    skipExternal: true,
  });
  const message = buildRecommendationMessage(preferences, result);

  assert.ok(message.length > 0);
  assert.doesNotMatch(message, /undefined/);
});

// --- Первая итерация улучшений подбора ---

// Кнопка «Попереживать» раньше искала книги с целями «подумать» и
// «вдохновиться», хотя в каталоге есть отдельное значение «попереживать».
// Проверяем сам маппинг: доля попаданий зависит от состава каталога, а правило —
// нет.
test("цель «Попереживать» ищет книги с целью «попереживать»", () => {
  assert.deepEqual(goalToLegacyGoalsMap.emotional, ["попереживать"]);
});

// Ровно та ошибка, которая была: цель указывает на значение, которого нет ни у
// одной книги, и вариант ответа тихо перестаёт работать.
test("каждая цель опроса указывает на значения, которые есть в каталоге", () => {
  const knownGoals = new Set(books.flatMap((book) => book.goal || []));

  for (const [goal, legacyGoals] of Object.entries(goalToLegacyGoalsMap)) {
    assert.ok(legacyGoals.length > 0, `цель "${goal}" ни на что не указывает`);

    for (const legacyGoal of legacyGoals) {
      assert.ok(
        knownGoals.has(legacyGoal),
        `цель "${goal}" ищет "${legacyGoal}", но такого значения нет ни у одной книги`,
      );
    }
  }
});

test("каждый вариант цели остаётся рабочим", async () => {
  for (const goal of goals) {
    const result = await recommendBooks(
      { goal, vibe: "any", genre: "any", pace: "any", length: "any" },
      { chainSeed: 1, chainPage: 0, skipExternal: true },
    );

    assert.ok(
      result.roleRecommendations && result.roleRecommendations.exact,
      `цель "${goal}" не вернула рекомендацию`,
    );
  }
});

const complexityRanks = { low: 0, medium: 1, high: 2 };

// Собирает книги, которые алгоритм сам показывает как safe для этих же ответов.
// Пригодность книги в роли safe от страницы не зависит, меняются только seed и
// список уже показанного, поэтому любая такая книга была доступна и на первой
// странице. Это даёт список кандидатов, не дублируя внутренние правила отбора.
async function collectSafeCandidates(preferences, pages = 6) {
  const candidates = new Map();

  for (let page = 0; page < pages; page++) {
    const result = await recommendBooks(preferences, {
      chainSeed: 1,
      chainPage: page,
      skipExternal: true,
    });
    const safe = result.roleRecommendations && result.roleRecommendations.safe;

    if (safe) {
      candidates.set(safe.title, safe);
    }
  }

  return [...candidates.values()];
}

// Карточка подписана «Более легкий вариант», поэтому safe не должен быть сложнее
// exact. Ограничение снимается только там, где подходящего кандидата нет вовсе —
// и именно это здесь проверяется, без опоры на конкретный жанр или книгу.
test("если есть кандидат не сложнее exact, safe обязан его выбрать", async () => {
  const avoidable = [];

  for (const preferences of everyCombination()) {
    const result = await recommendBooks(preferences, {
      chainSeed: 1,
      chainPage: 0,
      skipExternal: true,
    });
    const { exact, safe } = result.roleRecommendations || {};

    if (!exact || !safe) {
      continue;
    }

    if (complexityRanks[safe.complexity] <= complexityRanks[exact.complexity]) {
      continue;
    }

    const witness = (await collectSafeCandidates(preferences)).find(
      (book) =>
        book.title !== exact.title &&
        complexityRanks[book.complexity] <= complexityRanks[exact.complexity],
    );

    if (witness) {
      avoidable.push({
        preferences,
        exact: `${exact.title} (${exact.complexity})`,
        safe: `${safe.title} (${safe.complexity})`,
        witness: `${witness.title} (${witness.complexity})`,
      });
    }
  }

  assert.deepEqual(
    avoidable.slice(0, 3),
    [],
    "safe оказался сложнее exact, хотя более лёгкий кандидат существовал",
  );
});

// very_fast слит с fast: отдельной категории больше нет, но единственная книга
// с таким темпом обязана остаться достижимой.
test("very_fast слит с fast и книга не потеряна", async () => {
  const veryFast = books.filter((book) => book.pace === "very_fast");

  if (veryFast.length === 0) {
    return;
  }

  const reachable = new Set();

  for (const goal of goals) {
    for (const vibe of vibes) {
      for (let page = 0; page < 4; page++) {
        const result = await recommendBooks(
          { goal, vibe, genre: "any", pace: "fast", length: "any" },
          { chainSeed: 1, chainPage: page, skipExternal: true },
        );
        const roles = result.roleRecommendations || {};

        for (const role of ["exact", "safe", "stretch"]) {
          if (roles[role]) {
            reachable.add(roles[role].title);
          }
        }
      }
    }
  }

  for (const book of veryFast) {
    assert.ok(
      reachable.has(book.title),
      `«${book.title}» с pace=very_fast не выдаётся по запросу «Динамичный»`,
    );
  }
});

test("ответ pace=very_fast обрабатывается как fast", async () => {
  const options = { chainSeed: 3, chainPage: 0, skipExternal: true };
  const base = { goal: "dynamic", vibe: "any", genre: "any", length: "any" };

  const asFast = await recommendBooks({ ...base, pace: "fast" }, options);
  const asVeryFast = await recommendBooks({ ...base, pace: "very_fast" }, options);

  assert.equal(
    asVeryFast.roleRecommendations.exact.title,
    asFast.roleRecommendations.exact.title,
  );
});
