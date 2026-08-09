// Сброс истории, кэша и дайджестов (файлы + MongoDB).
import fs from "fs";
import path from "path";
import { connect, dbInstance } from "../clients/db";
import * as collectCache from "./cache-store.js";
import log from "../logger.js";

async function clearMongoCollection(name: string) {
  try {
    await connect();
    const r = await dbInstance().collection(name).deleteMany({});
    if (r.deletedCount) log.info(`Mongo ${name}: ${r.deletedCount} docs cleared`);
  } catch {}
}

export default async function resetData() {
  // Файлы data/
  const dir = path.join(__dirname, '..', '..', 'data');
  if (fs.existsSync(dir)) {
    for (const name of fs.readdirSync(dir)) {
      if (/^(history|digest|rejected)\./.test(name)) {
        const p = path.join(dir, name);
        fs.unlinkSync(p);
        log.info(`Removed ${p}`);
      }
    }
  }

  // MongoDB
  await Promise.all([
    clearMongoCollection('history'),
    clearMongoCollection('digest'),
    clearMongoCollection('rejected'),
    collectCache.clear().then(r => r.forEach(p => log.info(`Removed ${p}`))).finally(() => process.exit()),
  ]);
}
