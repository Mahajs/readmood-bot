const test = require("node:test");
const assert = require("node:assert/strict");

const {
  recommendBooks,
  findLocalBooks,
  buildRecommendationMessage,
  goalToLegacyGoalsMap,
  toneCatalog,
} = require("../src/services/recommender");
const { books } = require("../src/data/books");
const bot = require("../src/bot");

// Пять состояний первого вопроса (см. optionCatalog.goal). «random» проверяется
// отдельным тестом случайного режима.
const goals = ["relax", "inspire", "emotional", "reflective", "immerse"];

// Реальные конечные состояния опроса. Опрос адаптивный: третий вопрос (tone)
// зависит от жанра, а темп спрашивается не для всех жанров (genrePlan). Вопрос об
// объёме убран из опроса полностью. Перебираем именно то, что пользователь может
// собрать кнопками, — не абстрактные сочетания полей, которых в интерфейсе нет.
function enumerateSurveyStates() {
  const states = [];
  const genreValues = Object.keys(bot.toneByGenre);
  // Пользователь может выбрать и «Не важно» (any) в первом вопросе.
  const surveyGoals = [...goals, "any"];

  for (const goal of surveyGoals) {
    for (const genre of genreValues) {
      const tones = bot.toneByGenre[genre];
      const plan = bot.genrePlan[genre];
      const paces = plan.askPace ? ["slow", "medium", "fast", "any"] : [null];

      for (const tone of tones.map((code) => bot.optionCatalog.tone[code].value)) {
        for (const pace of paces) {
          states.push({ goal, genre, tone, pace, length: null });
        }
      }
    }
  }

  return states;
}

// Полный перебор реального опроса: ни одно достижимое сочетание ответов не должно
// падать или оставлять пользователя без «точного попадания».
test("любое достижимое сочетание ответов даёт рекомендацию", async () => {
  const states = enumerateSurveyStates();
  const failures = [];

  for (const preferences of states) {
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
  assert.ok(states.length > 200, `ожидали много состояний, получили ${states.length}`);
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
      { goal: "relax", tone: "any", genre, pace: "any", length: "any" },
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
    { title: 'Магазин чудес "Намия"', genre: "novel" },
  ];

  for (const { title, genre } of cases) {
    assert.ok(
      books.some((book) => book.title === title),
      `«${title}» пропала из каталога — обнови правило подбора`,
    );

    const found = await recommendBooks(
      { goal: "emotional", tone: "any", genre, pace: "any", length: "any" },
      { chainSeed: 1, chainPage: 0, skipExternal: true },
    );

    assert.ok(found.roleRecommendations.exact);
  }
});

test("цепочка «Еще варианты» не повторяет книги", async () => {
  const preferences = {
    goal: "immerse",
    tone: "any",
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
    tone: "warm",
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
    tone: "any",
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

// --- Первый вопрос: состояния читателя ---

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

// Содержательные состояния в опросе должны в точности совпадать с ключами
// маппинга. «random» (случайный режим) и «any» («Не важно» — намеренно не даёт
// бонуса по цели) исключены. Защита от рассинхрона optionCatalog и recommender.
test("состояния первого вопроса совпадают с маппингом целей", () => {
  const surveyGoals = Object.values(bot.optionCatalog.goal)
    .map((entry) => entry.value)
    .filter((value) => value !== "random" && value !== "any");

  assert.deepEqual(surveyGoals.sort(), Object.keys(goalToLegacyGoalsMap).sort());
});

test("каждый вариант цели остаётся рабочим", async () => {
  for (const goal of goals) {
    const result = await recommendBooks(
      { goal, tone: "any", genre: "any", pace: "any", length: "any" },
      { chainSeed: 1, chainPage: 0, skipExternal: true },
    );

    assert.ok(
      result.roleRecommendations && result.roleRecommendations.exact,
      `цель "${goal}" не вернула рекомендацию`,
    );
  }
});

// «Не важно» (goal=any) намеренно не даёт бонуса по цели, но обязана оставаться
// рабочим состоянием опроса. Тон всегда конкретный (шаг tone не предлагает «any»),
// поэтому у книги остаётся источник очков — рекомендация обязана находиться.
test("вариант «Не важно» в первом вопросе возвращает рекомендацию", async () => {
  const genreValues = Object.keys(bot.toneByGenre);

  for (const genre of genreValues) {
    const tone = bot.optionCatalog.tone[bot.toneByGenre[genre][0]].value;
    const result = await recommendBooks(
      { goal: "any", tone, genre, pace: "any", length: null },
      { chainSeed: 1, chainPage: 0, skipExternal: true },
    );

    assert.ok(
      result.roleRecommendations && result.roleRecommendations.exact,
      `цель «Не важно» (any) не вернула рекомендацию для жанра "${genre}"`,
    );
  }
});

const complexityRanks = { low: 0, medium: 1, high: 2 };

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
// exact. Ограничение снимается только там, где подходящего кандидата нет вовсе.
test("если есть кандидат не сложнее exact, safe обязан его выбрать", async () => {
  const avoidable = [];

  for (const preferences of enumerateSurveyStates()) {
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
// с таким темпом обязана остаться достижимой (темп спрашивается для романа и
// классики, поэтому перебираем эти жанры).
test("very_fast слит с fast и книга не потеряна", async () => {
  const veryFast = books.filter((book) => book.pace === "very_fast");

  if (veryFast.length === 0) {
    return;
  }

  const reachable = new Set();

  for (const genre of ["novel", "classic", "any"]) {
    for (const tone of bot.toneByGenre[genre].map((c) => bot.optionCatalog.tone[c].value)) {
      for (let page = 0; page < 4; page++) {
        const result = await recommendBooks(
          { goal: "relax", tone, genre, pace: "fast", length: "any" },
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
  const base = { goal: "relax", tone: "prdark", genre: "novel", length: "any" };

  const asFast = await recommendBooks({ ...base, pace: "fast" }, options);
  const asVeryFast = await recommendBooks({ ...base, pace: "very_fast" }, options);

  assert.equal(
    asVeryFast.roleRecommendations.exact.title,
    asFast.roleRecommendations.exact.title,
  );
});

// --- Покрытие поджанров внутри жанров «Детектив» и «Классика» ---
//
// Жанры detective/classic сопоставляются по спискам в structuredGenreProfiles.
// Эти тесты фиксируют, что нуар, скандинавский криминал и русская классика
// достижимы через свой жанр. Достижимость проверяется через сам алгоритм, по
// всем адаптивным вариантам тона этого жанра и разным seed.
async function reachableTitlesForGenre(genre) {
  const tones = bot.toneByGenre[genre].map((code) => bot.optionCatalog.tone[code].value);
  const lengths = ["short", "medium", "long", "any"];
  const reachable = new Set();

  // Пользователь может прийти с любым из пяти состояний — сметаем все, чтобы
  // проверять достижимость книги через жанр целиком, а не через один вход.
  for (const goal of goals) {
    for (const tone of tones) {
      for (const length of lengths) {
        for (let seed = 0; seed < 6; seed++) {
          for (let page = 0; page < 2; page++) {
            const result = await recommendBooks(
              { goal, tone, genre, pace: "any", length },
              { chainSeed: seed, chainPage: page, skipExternal: true },
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
    }
  }

  return reachable;
}

test("жанр «Детектив» открывает нуар и скандинавский криминал, а не только головоломку", async () => {
  const reachable = await reachableTitlesForGenre("detective");

  for (const title of [
    "Жертва подозреваемого X",
    "Убийство в Восточном экспрессе",
    "Приключения Шерлока Холмса",
  ]) {
    assert.ok(
      books.some((book) => book.title === title),
      `«${title}» пропала из каталога — обнови профиль detective`,
    );
    assert.ok(reachable.has(title), `«${title}» больше не достижима как детектив`);
  }

  for (const title of [
    "Мальтийский сокол",
    "Почтальон всегда звонит дважды",
    "Нет орхидей для мисс Блэндиш",
    "Полиция",
    "Пересыхающее озеро",
  ]) {
    assert.ok(
      books.some((book) => book.title === title),
      `«${title}» пропала из каталога — обнови профиль detective`,
    );
    assert.ok(
      reachable.has(title),
      `«${title}» недостижима через жанр «Детектив»`,
    );
  }
});

test("жанр «Классика» открывает русскую классику, а не только японскую", async () => {
  const reachable = await reachableTitlesForGenre("classic");

  for (const title of [
    "Братья Карамазовы",
    "Преступление и наказание",
    "Отцы и дети",
    "Обломов",
    "Палата №6",
  ]) {
    assert.ok(
      books.some((book) => book.title === title),
      `«${title}» пропала из каталога — обнови профиль classic`,
    );
    assert.ok(
      reachable.has(title),
      `«${title}» недостижима через жанр «Классика»`,
    );
  }

  for (const title of ["Кокоро", "Золотой храм"]) {
    assert.ok(reachable.has(title), `«${title}» больше не достижима как классика`);
  }
});

test("через жанр «Детектив» достижим весь основной криминальный пласт каталога", async () => {
  const crimeAuthors = new Set([
    "Дэшилл Хэммет",
    "Джеймс М. Кейн",
    "Джеймс Хэдли Чейз",
    "Корнелл Вулрич",
    "Ю Несбё",
    "Арнальдур Индридасон",
    "Карин Фоссум",
    "Джозеф Нокс",
    "Деннис Лихейн",
    "Кэйго Хигасино",
    "Агата Кристи",
    "Артур Конан Дойл",
    "Джон Диксон Карр",
    "Эдгар Аллан По",
    "Сэйтё Мацумото",
    "Содзи Симада",
    "Жорж Сименон",
  ]);
  const crimeTitles = books
    .filter((book) => crimeAuthors.has(book.author))
    .map((book) => book.title);
  const reachable = await reachableTitlesForGenre("detective");
  const found = crimeTitles.filter((title) => reachable.has(title));

  assert.ok(
    found.length >= 16,
    `через «Детектив» достижимо только ${found.length} криминальных книг из ${crimeTitles.length}`,
  );
});
