// Сброс истории, кэша и дайджестов.
const fs = require('fs');
const path = require('path');
const collectCache = require('./cache');
const log = require('./logger');

function resetData() {
  const dir = path.join(__dirname, '..', 'data');
  if (!fs.existsSync(dir)) return;
  const historyFile = path.join(dir, 'history.json');
  if (fs.existsSync(historyFile)) {
    fs.unlinkSync(historyFile);
    log.info(`Removed ${historyFile}`);
  }
  for (const p of collectCache.clear()) {
    log.info(`Removed ${p}`);
  }
  for (const name of fs.readdirSync(dir)) {
    if (/^(digest|rejected)-.*\.json$/.test(name)) {
      const p = path.join(dir, name);
      fs.unlinkSync(p);
      log.info(`Removed ${p}`);
    }
  }
}

module.exports = resetData;
