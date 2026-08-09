// Команда digest: показать последний дайджест.
import fs from "fs";
import path from "path";
import { connect, dbInstance } from "../clients/db";
import log from "../logger.js";

async function digest(opts: Record<string, any> = {}) {
  // Пробуем MongoDB
  try {
    await connect();
    const docs = await dbInstance().collection('digest')
      .find({}, { sort: { date: -1 }, limit: 1 })
      .toArray();
    if (docs.length) {
      const entries = docs[0].entries || [];
      if (opts.json) {
        console.log(JSON.stringify(entries, null, 2));
      } else {
        console.log(`\n=== Дайджест ${docs[0].date} (${entries.length} вакансий) ===\n`);
        for (const e of entries) {
          console.log(`[${e.score ?? '?'}/10] ${e.title} @ ${e.employer}`);
          console.log(`      ${e.salary || '—'} | ${e.area || '—'}`);
          console.log(`      ${e.url}`);
          if (e.coverLetter) console.log(`      -> письмо: ${e.coverLetter.slice(0, 80)}...`);
          console.log();
        }
      }
      return;
    }
  } catch {}

  // Fallback: читаем .md файл
  const files = fs.readdirSync(path.join(__dirname, '..', '..', 'data'))
    .filter(f => /^digest-.*\.md$/.test(f))
    .sort()
    .reverse();
  if (!files.length) {
    log.info('No digest found.');
    return;
  }
  console.log(fs.readFileSync(path.join(__dirname, '..', '..', 'data', files[0]), 'utf-8'));
}

export default digest;
