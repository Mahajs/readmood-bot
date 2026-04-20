const dotenv = require("dotenv");
const { getPollingBot } = require("./bot");

dotenv.config();

const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
  console.error("Missing TELEGRAM_BOT_TOKEN in environment variables.");
  process.exit(1);
}

getPollingBot(token);
