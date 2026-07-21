# ReadMoodBot

ReadMoodBot is a Telegram bot for book recommendations.

It helps a user choose a book by state, atmosphere, pace, and genre. The core recommendation layer is built on a local curated database, while Google Books is used as an external source for search and reference.

The working principle is simple:

```text
Локальная база = вкус и рекомендации
Внешние базы = поиск и справка
```

## Product Scope

ReadMoodBot is a small curated Telegram book recommendation bot with intentionally limited scope.

It is meant to do two things well:

1. recommend a book through a short guided flow
2. help find a book or author through local and external search data

It is not trying to become a Goodreads clone, a social reading platform, or a personal library tracker.

## User Flows

Main menu (start screen):

- `📖 Что почитать?` — guided recommendation flow
- `🎲 Удиви меня` — one-book random recommendation flow
- `ℹ️ Как это работает` — short product explanation

Commands:

- `/find` — search by author or title
- `/help` — help screen with the same core routes

Supporting actions:

- `🔁 Еще варианты` — continue the current recommendation chain without repeats
- `🔄 Подобрать заново` — restart the flow

## Recommendation Engine

The bot uses a three-role recommendation model:

- `exact` — the closest match
- `safe` — a lighter or easier option
- `stretch` — a nearby but less obvious option

Ordinary recommendations:

- use a stateless `seed + page` approach
- work through Telegram `callback_data`
- avoid repeats between presses of `🔁 Еще варианты`
- show an empty-state when the current chain is exhausted

Random scenario:

- returns one book at a time
- uses seeded shuffle per chain
- draws from the full local catalog
- avoids repeats within a chain
- shows an empty-state when the pool is exhausted

## Data Model

Each local book entry in [src/data/books.js](src/data/books.js) uses this structure:

```js
{
  title,
  author,
  genre,
  mood,
  format,
  length,
  goal,
  description,
  vibe,
  themes,
  pace,
  complexity,
  cover,               // optional: path under public/covers, e.g. "/covers/1984.jpg"
  recommendationText   // optional: overrides description in cards; unused so far
}
```

The required fields and their allowed values are defined in [src/data/bookSchema.js](src/data/bookSchema.js).

`recommendationText` is optional and currently set on no local book — every card falls back to `description`. It is always present on results coming from Google Books, where [src/services/googleBooks.js](src/services/googleBooks.js) fills it in.

Author profiles live separately in [src/data/authors.js](src/data/authors.js) (name, bio, wiki link, optional portrait path).

Current state:

- 102 validated books
- 75 author profiles
- 75 of 102 books have a cover image; the rest render as text-only cards
- no author has a `portraitPath` yet, so author cards are text-only; the
  `sendPhoto` path in [src/bot.js](src/bot.js) stays dormant until
  `public/authors/` exists
- schema validation via:

```bash
npm run validate-books
```

The validator also checks that the hardcoded title and author rules in
`structuredGenreProfiles` still point at books that exist, so renaming a book
in `books.js` cannot silently disable a matching rule.

## Development

Install dependencies:

```bash
npm install
```

Create local environment file:

```bash
cp .env.example .env
```

Run locally in polling mode:

```bash
npm start
```

Validate the local database:

```bash
npm run validate-books
```

Run the test suite (`node:test`, no extra dependencies):

```bash
npm test
```

Run both at once — this is what CI runs:

```bash
npm run check
```

The tests cover the catalog schema, cover and portrait files actually existing on
disk, all 5760 survey answer combinations returning a recommendation, chain
de-duplication, seed determinism, and the genre rules staying in sync with
`books.js`.
CI runs on every push and pull request via
[.github/workflows/ci.yml](.github/workflows/ci.yml).

Useful scripts:

```bash
npm run set-webhook
npm run delete-webhook
```

## Deployment

Production deployment is built for Vercel with Telegram webhook delivery.

Local `.env` typically contains:

```env
TELEGRAM_BOT_TOKEN=your_telegram_bot_token_here
GOOGLE_BOOKS_API_KEY=your_google_books_api_key_here
WEBHOOK_BASE_URL=https://your-project.vercel.app
TELEGRAM_WEBHOOK_SECRET=replace_with_random_secret
```

In Vercel, the same values should be configured as Environment Variables:

- `TELEGRAM_BOT_TOKEN`
- `GOOGLE_BOOKS_API_KEY`
- `WEBHOOK_BASE_URL`
- `TELEGRAM_WEBHOOK_SECRET`

The webhook endpoint is:

- `api/telegram-webhook.js`

## Current Architecture Notes

- The bot is designed around stateless callbacks for Vercel webhook execution.
- Recommendation and random chains use compact `seed + page` state instead of in-memory session storage.
- Core genre and matching heuristics still live directly inside [src/services/recommender.js](src/services/recommender.js).
- That recommendation-layer coupling is known technical debt and a likely next cleanup target.

## Project Structure

- `src/index.js` — local polling entrypoint
- `src/bot.js` — bot routes, keyboards, callback handling
- `src/services/recommender.js` — recommendation logic
- `src/services/googleBooks.js` — Google Books integration
- `src/data/books.js` — curated local book database
- `src/data/bookSchema.js` — required fields and allowed values
- `src/data/authors.js` — author profiles for author cards
- `public/covers/` — book cover images served by absolute URL
- `api/telegram-webhook.js` — Vercel webhook endpoint
- `scripts/validate-books.js` — local database validator
- `scripts/set-webhook.js` — register Telegram webhook
- `scripts/delete-webhook.js` — remove Telegram webhook
- `tests/` — `node:test` suites for the catalog and the recommender

## Near-term / Before Stable v1

- add explicit `randomEligible` support instead of keeping random participation only in code
- fill in `vibe` tags for the whole catalog — atmosphere is the second survey question but the weakest matching signal today
- rebalance scoring weights: genre currently outweighs atmosphere, goal, pace, and length combined
- add covers for the remaining 27 books
- add author portraits under `public/authors/` and fill in `portraitPath`
- covers are named `.jpg` but many files are actually WebP or PNG; worth
  normalising the extensions so the served content type matches
- improve small search details if the current search UX needs another pass

## Out of Scope / Not Planned

- user accounts
- ratings and reviews
- social features
- personal reading tracker
- large catalog platform features
