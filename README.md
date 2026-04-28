# ReadMoodBot

ReadMoodBot is a Telegram bot for book recommendations.

It helps a user choose a book by state, atmosphere, pace, and genre. The core recommendation layer is built on a local curated database, while Google Books is used as an external source for search and reference.

The working principle is simple:

```text
Локальная база = вкус и рекомендации
Внешние базы = поиск и справка
```

## User Flows

Main entry points:

- `📖 Что почитать?` — guided recommendation flow
- `📚 Найти книгу` — search by author or title
- `✨ Подборки` — editor-curated collections
- `ℹ️ Как это работает` — short product explanation
- `/help` — help screen with the same core routes

Supporting actions:

- `🔁 Еще варианты` — continue the current recommendation chain without repeats
- `🔄 Подобрать заново` — restart the flow
- `🎲 Удиви меня` — one-book random recommendation flow

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
- uses a curated random pool of 35 books
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
  recommendationText,
  vibe,
  themes,
  pace,
  complexity
}
```

Current state:

- 68 validated books
- local curated recommendation texts
- schema validation via:

```bash
npm run validate-books
```

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
- `src/data/collections.js` — editorial collections
- `api/telegram-webhook.js` — Vercel webhook endpoint
- `scripts/set-webhook.js` — register Telegram webhook
- `scripts/delete-webhook.js` — remove Telegram webhook

## Roadmap

- extract shared enums and schema into `bookSchema.js`
- add explicit `randomEligible` support instead of keeping random participation only in code
- introduce feedback modifiers for tuning future recommendations
- continue expanding the local curated database
