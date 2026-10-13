const dotenv = require("dotenv");
const { getPollingBot } = require("./bot");
const { assertPollingAllowed } = require("./services/botMode");

dotenv.config();

const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
  console.error("Missing TELEGRAM_BOT_TOKEN in environment variables.");
  process.exit(1);
}

try {
  assertPollingAllowed(token, process.env);
} catch (error) {
  console.error(`Refusing to start polling: ${error.message}`);
  process.exit(1);
}

getPollingBot(token);
