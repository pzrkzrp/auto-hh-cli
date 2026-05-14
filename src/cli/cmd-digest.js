// Команда digest: показать последний дайджест.
const fs = require('fs');
const path = require('path');
const log = require('../logger');

async function digest(opts = {}) {
  const dir = path.join(__dirname, '..', '..', 'data');
  if (!fs.existsSync(dir)) {
    log.error('No data dir. Run `auto-hh search` first.');
    return;
  }
  const files = fs.readdirSync(dir)
    .filter(f => /^digest-.*\.json$/.test(f))
    .sort()
    .reverse();
  if (!files.length) {
    log.info('No digest files found.');
    return;
  }

  for (const name of files) {
    const data = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf-8'));
    const entries = data.matched || [];

    if (opts.json) {
      console.log(JSON.stringify(entries, null, 2));
    } else {
      console.log(`\n=== ${name} (${entries.length} вакансий) ===\n`);
      for (const e of entries) {
        console.log(`[${e.score ?? '?'}/10] ${e.title} @ ${e.employer}`);
        console.log(`      ${e.salary} | ${e.area}`);
        console.log(`      ${e.url}`);
        if (e.coverLetter) console.log(`      -> письмо: ${e.coverLetter.slice(0, 80)}...`);
        console.log();
      }
    }
  }
}

module.exports = digest;
