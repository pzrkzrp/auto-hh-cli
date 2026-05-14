// Сброс истории, кэша и дайджестов.
import fs from "fs";
import path from "path";
import * as collectCache from "./cache.js";
import log from "./logger.js";

export default async function resetData() {
  const dir = path.join(__dirname, '..', 'data');
  if (fs.existsSync(dir)) {
    const historyFile = path.join(dir, 'history.json');
    if (fs.existsSync(historyFile)) {
      fs.unlinkSync(historyFile);
      log.info(`Removed ${historyFile}`);
    }
    for (const name of fs.readdirSync(dir)) {
      if (/^(digest|rejected)-.*\.json$/.test(name)) {
        const p = path.join(dir, name);
        fs.unlinkSync(p);
        log.info(`Removed ${p}`);
      }
    }
  }

  const removed = await collectCache.clear();
  for (const p of removed) {
    log.info(`Removed ${p}`);
  }
}
