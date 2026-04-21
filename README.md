# Telegram Book Recommendation Bot

Telegram-бот на JavaScript для подбора книг по параметрам и поиска по локальной базе + Google Books.

## Что умеет

- подбор книг по формату, жанру, настроению, длине и цели чтения
- поиск по названию и автору через `/find`
- локальные рекомендации с твоими живыми описаниями
- внешние результаты из Google Books

## Архитектура после перехода на webhook

Раньше бот работал через `long polling`: локальный процесс постоянно висел в сети и сам спрашивал Telegram, есть ли новые обновления.

Для `Vercel` это плохая модель, потому что:

- Vercel рассчитан на HTTP-функции, которые запускаются по запросу
- у Vercel нет постоянно живого процесса под polling
- in-memory состояние между вызовами функции ненадежно

Поэтому проект был переделан под `webhook`.

### Что это означает

Теперь схема такая:

1. Telegram получает сообщение пользователя
2. Telegram делает `POST` на твой URL на Vercel
3. Vercel вызывает функцию `api/telegram-webhook.js`
4. Функция передает `update` в общую логику бота
5. Бот отвечает пользователю через Telegram Bot API

### Почему пришлось убрать хранение сессии в памяти

Раньше состояние опроса хранилось в памяти процесса. Для serverless это ненадежно:

- следующий запрос может попасть в другой инстанс
- память функции не гарантированно сохраняется между вызовами

Поэтому бот стал stateless для сценария опроса:

- текущее состояние выбора кодируется в `callback_data`
- при нажатии кнопки Telegram присылает это состояние обратно
- сервер восстанавливает шаг без общей памяти

Это ключевой архитектурный переход для Vercel.

## Структура проекта

- `src/index.js` — локальный запуск в polling-режиме
- `src/bot.js` — общая логика бота, stateless-опрос и обработка update
- `src/services/recommender.js` — алгоритм рекомендаций
- `src/services/googleBooks.js` — работа с Google Books API
- `src/data/books.js` — локальная база книг
- `api/telegram-webhook.js` — Vercel webhook endpoint
- `scripts/set-webhook.js` — регистрация webhook в Telegram
- `scripts/delete-webhook.js` — удаление webhook
- `vercel.json` — конфиг Vercel Functions
- `ecosystem.config.js` — запуск через PM2 для VPS
- `deploy/readmood-bot.service` — запуск через systemd для VPS

## Локальный запуск

### 1. Установить зависимости

```bash
npm install
```

### 2. Создать `.env`

```bash
cp .env.example .env
```

### 3. Заполнить переменные

```env
TELEGRAM_BOT_TOKEN=your_telegram_bot_token_here
GOOGLE_BOOKS_API_KEY=your_google_books_api_key_here
WEBHOOK_BASE_URL=https://your-project.vercel.app
TELEGRAM_WEBHOOK_SECRET=replace_with_random_secret
```

Обязательные:

- `TELEGRAM_BOT_TOKEN`

Желательные:

- `GOOGLE_BOOKS_API_KEY`
- `WEBHOOK_BASE_URL`
- `TELEGRAM_WEBHOOK_SECRET`

### 4. Локально запустить polling-версию

```bash
npm start
```

Этот режим нужен для локальной разработки. На Vercel он не используется.

## Подготовка к деплою на Vercel

### Этап 1. Почему нам нужен webhook

Telegram поддерживает два взаимоисключающих режима доставки обновлений:

- `getUpdates` / long polling
- `setWebhook`

Одновременно использовать их нельзя.

Когда бот переезжает на Vercel, надо перейти на `setWebhook`.

Источник: [Telegram Bot API](https://core.telegram.org/bots/api)

### Этап 2. Что изменено в коде

#### 1. Вынесена общая обработка update

В [src/bot.js](/Users/beedju/Documents/Playground/src/bot.js) теперь есть единая функция обработки Telegram update:

- локально ее вызывают polling listeners
- на Vercel ее вызывает webhook endpoint

Это сделано, чтобы бизнес-логика была одна и та же.

#### 2. Опрос стал stateless

Состояние выбора больше не хранится в `Map`.

Теперь:

- каждый шаг опроса кодируется в `callback_data`
- следующий запрос несет уже собранное состояние
- сервер заново восстанавливает прогресс

Это решение специально сделано под serverless.

#### 3. Добавлен webhook endpoint

Файл [api/telegram-webhook.js](/Users/beedju/Documents/Playground/api/telegram-webhook.js):

- принимает `POST` от Telegram
- проверяет секрет `X-Telegram-Bot-Api-Secret-Token`
- передает update в общую логику бота

#### 4. Добавлены скрипты управления webhook

В [package.json](/Users/beedju/Documents/Playground/package.json):

- `npm run set-webhook`
- `npm run delete-webhook`

Они нужны, чтобы переключать Telegram между webhook и polling режимами.

## Деплой на Vercel

### 1. Залить проект в GitHub

Если проект еще не в GitHub:

```bash
git add .
git commit -m "Prepare bot for Vercel webhook deployment"
```

Потом привязать удаленный репозиторий и отправить код.

### 2. Создать проект в Vercel

1. Открой [Vercel](https://vercel.com/)
2. Нажми `Add New...`
3. Выбери `Project`
4. Импортируй GitHub-репозиторий
5. Нажми `Deploy`

Для этого проекта отдельный build step не нужен: Vercel сам поднимет функции из папки `api`.

### 3. Добавить переменные окружения в Vercel

В Vercel Project Settings -> `Environment Variables` добавь:

- `TELEGRAM_BOT_TOKEN`
- `GOOGLE_BOOKS_API_KEY`
- `WEBHOOK_BASE_URL`
- `TELEGRAM_WEBHOOK_SECRET`

Пример:

```env
TELEGRAM_BOT_TOKEN=...
GOOGLE_BOOKS_API_KEY=your_google_books_api_key_here
WEBHOOK_BASE_URL=https://your-project.vercel.app
TELEGRAM_WEBHOOK_SECRET=some_long_random_secret
```

`WEBHOOK_BASE_URL` должен совпадать с боевым доменом Vercel проекта.

### 4. Зачем нужен `TELEGRAM_WEBHOOK_SECRET`

Telegram умеет присылать заголовок `X-Telegram-Bot-Api-Secret-Token`, если ты передал `secret_token` в `setWebhook`.

Мы используем это как простую проверку:

- если секрет совпал, принимаем запрос
- если нет, отклоняем

Это не заменяет полную сетевую защиту, но убирает тривиальные случайные обращения к endpoint.

Источник: [Telegram Bot API](https://core.telegram.org/bots/api)

## Регистрация webhook в Telegram

После первого успешного деплоя нужно один раз зарегистрировать webhook.

### Вариант 1. Из локальной машины

Заполни локальный `.env` и выполни:

```bash
npm run set-webhook
```

Скрипт возьмет:

- `TELEGRAM_BOT_TOKEN`
- `WEBHOOK_BASE_URL`
- `TELEGRAM_WEBHOOK_SECRET`

И отправит в Telegram `setWebhook`.

### Вариант 2. Снять webhook

Если захочешь вернуться к polling:

```bash
npm run delete-webhook
```

После этого можно снова локально запускать:

```bash
npm start
```

## Как проверить, что Vercel-версия работает

### 1. Проверить деплой

В логах Vercel не должно быть ошибок загрузки функции.

### 2. Зарегистрировать webhook

```bash
npm run set-webhook
```

### 3. Остановить локальный polling

Если локально бот запущен:

```bash
Ctrl + C
```

Это важно. Нельзя одновременно держать локальный polling и webhook-конфигурацию, иначе поведение станет путаным.

### 4. Написать боту в Telegram

Проверь:

- `/start`
- `/find Осаму Дадзай`
- прохождение опроса через inline-кнопки

Если бот отвечает, значит webhook работает.

## Что важно понимать про ограничения Vercel

### 1. In-memory состояние нельзя считать надежным

Поэтому мы специально убрали серверную сессию для опроса.

### 2. Если позже появится “избранное”, история чтения, профили пользователей

Тогда понадобится внешнее хранилище:

- Postgres
- SQLite не подойдет для serverless-масштаба
- Vercel KV / Redis
- Supabase / Neon / Railway Postgres

### 3. Библиотека `node-telegram-bot-api` осталась

Но теперь она используется не как polling-движок на Vercel, а как клиент для отправки ответов. Это нормальный компромисс для текущего размера проекта.

## Редактирование базы книг

У каждой книги в [src/data/books.js](/Users/beedju/Documents/Playground/src/data/books.js) есть:

- `description` — короткое нейтральное описание
- `recommendationText` — живой текст для пользователя
- `vibe` — атмосфера книги
- `themes` — ключевые темы
- `pace` — темп чтения
- `complexity` — уровень сложности

Шаблон:

```js
{
  title: "Цветы для Элджернона",
  author: "Дэниел Киз",
  genre: "художественная литература",
  mood: ["эмоциональное", "вдумчивое"],
  format: "художественная",
  length: "короткая",
  goal: ["подумать", "вдохновиться"],
  description: "Короткое нейтральное описание.",
  recommendationText: "Более живой и личный текст, который увидит пользователь.",
  vibe: ["эмоциональная", "хрупкая", "созерцательная"],
  themes: ["одиночество", "поиск себя", "память"],
  pace: "медленная",
  complexity: "средняя"
}
```

Новые поля работают как мягкие усилители рекомендаций:

- `vibe` помогает точнее подбирать книги под настроение
- `themes` помогает связывать книгу с внутренним запросом пользователя
- `pace` позволяет отличать динамичное чтение от медленного и созерцательного
- `complexity` пригодится для следующего шага, если ты захочешь добавить в бота выбор уровня сложности

## Дальнейшие улучшения

- вынести пользователей и историю запросов в базу
- добавить “избранное”
- добавить “похожие книги”
- выделить подборки редактора
- сделать отдельный webhook setup status check
- добавить команду для проверки текущего webhook через `getWebhookInfo`
