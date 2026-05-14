// Простой логгер с уровнями и записью в файл.
const fs = require('fs');
const path = require('path');

const LOG_FILE = path.join(__dirname, '..', 'data', 'app.log');

function ensureDir() {
  const dir = path.dirname(LOG_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function write(level, msg, meta) {
  ensureDir();
  const ts = new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', hour12: false }).replace(',', '');
  const line = `[${ts}] [${level}] ${msg}` +
    (meta ? ' ' + JSON.stringify(meta) : '');
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + '\n');
}

module.exports = {
  info: (m, meta) => write('INFO', m, meta),
  warn: (m, meta) => write('WARN', m, meta),
  error: (m, meta) => write('ERROR', m, meta),
  debug: (m, meta) => process.env.DEBUG && write('DEBUG', m, meta),
};
