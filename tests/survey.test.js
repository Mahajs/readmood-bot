const test = require("node:test");
const assert = require("node:assert/strict");

const bot = require("../src/bot");
const { toneCatalog, getGenreMatchLevel } = require("../src/services/recommender");
const { books } = require("../src/data/books");

// Токены тона в опросе (optionCatalog.tone) и в алгоритме (toneCatalog) должны
// совпадать один в один — иначе кнопка ничего не значит для подбора.
test("токены тона в боте и в рекомендаторе совпадают", () => {
  const surveyTones = new Set(
    Object.values(bot.optionCatalog.tone).map((entry) => entry.value),
  );
  const engineTones = new Set(Object.keys(toneCatalog));

  assert.deepEqual([...surveyTones].sort(), [...engineTones].sort());
});

// Каждый адаптивный вариант тона обязан ссылаться на существующий токен и
// каждый жанр — предлагать хотя бы два варианта (иначе вопрос бессмысленен).
test("адаптивные варианты жанров корректны и непусты", () => {
  for (const [genre, codes] of Object.entries(bot.toneByGenre)) {
    assert.ok(codes.length >= 2, `у жанра "${genre}" меньше двух вариантов тона`);

    for (const code of codes) {
      assert.ok(
        bot.optionCatalog.tone[code],
        `жанр "${genre}" ссылается на несуществующий код тона "${code}"`,
      );
    }
  }
});

// Ни один адаптивный вариант не должен быть «мёртвым»: под каждый тон жанра
// обязана попасть хотя бы одна книга этого жанра.
test("под каждый адаптивный вариант попадает хотя бы одна книга жанра", () => {
  const realGenres = Object.keys(bot.toneByGenre).filter((g) => g !== "any");

  for (const genre of realGenres) {
    const genreBooks = books.filter((book) => getGenreMatchLevel(book, genre) >= 2);

    for (const code of bot.toneByGenre[genre]) {
      const profile = toneCatalog[bot.optionCatalog.tone[code].value];
      const count = genreBooks.filter((book) => {
        if (profile.vibes) {
          return profile.vibes.includes(book.vibe[0]);
        }
        if (profile.moods) {
          return (book.mood || []).some((m) => profile.moods.includes(m));
        }
        return false;
      }).length;

      assert.ok(
        count >= 1,
        `вариант «${bot.optionCatalog.tone[code].label}» пуст для жанра "${genre}"`,
      );
    }
  }
});

// Прогон опроса до конца по каждому жанру: правильное число шагов, ни одной
// пустой клавиатуры, состояние копится, callback_data декодируется обратно.
function walkSurvey(genreCode, extraPicks = {}) {
  let session = bot.createEmptySession();
  const asked = [];

  // Заранее выбранные ответы; на шаге tone берём первый вариант жанра.
  const picks = {
    goal: "rl",
    genre: genreCode,
    ...extraPicks,
  };

  while (true) {
    const step = bot.getNextStep(session);
    if (!step) break;

    const keyboard = bot.buildStepKeyboard(step, session);
    const flat = keyboard.flat();
    assert.ok(flat.length > 0, `пустая клавиатура на шаге ${step.key}`);

    // callback_data должна декодироваться в валидную сессию.
    for (const button of flat) {
      const decoded = bot.deserializeSession(
        button.callback_data.replace(/^state:/, ""),
      );
      assert.ok(decoded, "callback_data не декодируется");
    }

    asked.push(step.key);
    const pick = picks[step.key] || step.rows.flat()[0];
    session = { ...session, [step.key]: pick };
  }

  return { asked, session };
}

test("число шагов опроса зависит от жанра (адаптивная длина)", () => {
  // fantasy, нон-фикшн и детектив: goal, genre, tone — и всё (3 шага).
  assert.deepEqual(walkSurvey("fa").asked, ["goal", "genre", "tone"]);
  assert.deepEqual(walkSurvey("nf").asked, ["goal", "genre", "tone"]);
  assert.deepEqual(walkSurvey("de").asked, ["goal", "genre", "tone"]);
  // classic и novel: с темпом (4 шага). Вопрос об объёме убран отовсюду.
  assert.deepEqual(walkSurvey("cl").asked, ["goal", "genre", "tone", "pace"]);
  assert.deepEqual(walkSurvey("nv").asked, ["goal", "genre", "tone", "pace"]);
});

test("случайный режим завершает опрос сразу после первого вопроса", () => {
  const session = { ...bot.createEmptySession(), goal: "ra" };
  assert.equal(bot.getNextStep(session), null);
});

// Старые callback_data (со снятым теперь вопросом об атмосфере, ключ v=) не
// должны ломать декодирование — незнакомый ключ просто игнорируется.
test("старые callback_data не ломают опрос", () => {
  const session = bot.deserializeSession("o=rl;v=cz;g=de");
  assert.equal(session.goal, "rl");
  assert.equal(session.genre, "de");
  assert.equal(session.tone, null);
  // Следующий шаг — адаптивный тон детектива, а не падение.
  const next = bot.getNextStep(session);
  assert.equal(next.key, "tone");
});
