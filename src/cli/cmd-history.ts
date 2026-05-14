// Команда history: показать историю откликов.
import fs from "fs";
import path from "path";
import log from "../logger.js";

async function history(opts = {}) {
  const file = path.join(__dirname, '..', '..', 'data', 'history.json');
  if (!fs.existsSync(file)) {
    log.info('No history yet.');
    return;
  }
  const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
  const applied = Object.entries(data.applied || {});
  const seen = Object.entries(data.seen || {}).filter(([id]) => !data.applied[id]);

  if (opts.json) {
    console.log(JSON.stringify({ applied: data.applied, seenOnly: Object.fromEntries(seen) }, null, 2));
    return;
  }

  if (applied.length) {
    console.log(`\n=== Откликнулся (${applied.length}) ===`);
    for (const [id, meta] of applied.slice(-20)) {
      console.log(`  ${meta.title || id} @ ${meta.employer || '?'} [${meta.score ?? '?'}/10]`);
      console.log(`    ${meta.url || ''}`);
    }
  } else {
    console.log('\nНет откликов.');
  }

  if (seen.length) {
    console.log(`\n=== Просмотрено, без отклика (${seen.length}) ===`);
    for (const [id] of seen.slice(-10)) {
      console.log(`  ${id}`);
    }
  }
}

export default history;
