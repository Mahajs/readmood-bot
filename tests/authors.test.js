const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  authorProfiles,
  findAuthorProfileByName,
} = require("../src/data/authors");

const rootDir = path.join(__dirname, "..");

test("у каждого автора есть имя и биография", () => {
  assert.ok(Array.isArray(authorProfiles));
  assert.ok(authorProfiles.length > 0);

  for (const profile of authorProfiles) {
    assert.ok(
      profile.name && profile.name.trim(),
      `профиль без имени: ${JSON.stringify(profile).slice(0, 80)}`,
    );
    assert.ok(
      profile.bio && profile.bio.trim(),
      `«${profile.name}»: пустая биография`,
    );
  }
});

test("нет дублирующихся авторов", () => {
  const seen = new Set();

  for (const profile of authorProfiles) {
    const key = profile.name.trim().toLowerCase();
    assert.ok(!seen.has(key), `дубликат профиля: ${profile.name}`);
    seen.add(key);
  }
});

test("ссылки на вики выглядят как ссылки", () => {
  for (const profile of authorProfiles) {
    if (!profile.wikiUrl) {
      continue;
    }

    assert.match(
      profile.wikiUrl,
      /^https:\/\//,
      `«${profile.name}»: странная ссылка ${profile.wikiUrl}`,
    );
  }
});

// Портреты пока не заполнены ни у одного автора — карточка честно падает в
// текст. Но как только путь появится, он должен указывать на реальный файл:
// ровно на этом раньше расходились обложки книг.
test("если портрет указан, файл существует и путь имеет верный префикс", () => {
  for (const profile of authorProfiles) {
    const portraitPath = profile.portraitPath;

    if (!portraitPath) {
      continue;
    }

    if (/^https?:\/\//.test(portraitPath)) {
      continue;
    }

    assert.ok(
      portraitPath.startsWith("/authors/"),
      `«${profile.name}»: resolveAuthorPortraitUrl примет только путь вида /authors/..., получено "${portraitPath}"`,
    );

    assert.ok(
      fs.existsSync(path.join(rootDir, "public", portraitPath)),
      `«${profile.name}»: портрет ${portraitPath} не найден на диске`,
    );
  }
});

test("поиск автора по имени работает и не падает на мусоре", () => {
  const known = authorProfiles[0].name;

  assert.equal(findAuthorProfileByName(known).name, known);
  assert.ok(!findAuthorProfileByName("нет такого автора вообще"));
  assert.ok(!findAuthorProfileByName(""));
  assert.ok(!findAuthorProfileByName(undefined));
});
