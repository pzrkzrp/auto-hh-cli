#!/usr/bin/env node
// Прогоняет judge по вакансиям из кэша, минуя hh и историю.
// Использование:
//   node scripts/judge-only.js                          # все вакансии из сегодняшнего кэша
//   node scripts/judge-only.js 2026-05-13               # конкретная дата
//   node scripts/judge-only.js --id 127784576           # одна вакансия по id
//   node scripts/judge-only.js --id 127784576 --force   # перегнать даже если есть в кэше
//   node scripts/judge-only.js --reset-judgements       # сбросить все результаты и перегнать
require('dotenv').config();
const collectCache = require('../src/collect-cache');
const { loadResume } = require('../src/resume');
const { loadConfig } = require('../src/config');
const { judgeVacancy, judgeVacanciesBatch } = require('../src/judge');
const log = require('../src/logger');

function printVerdict(v, j) {
  const icon = j.fit ? '✓' : '✗';
  console.log(`\n${icon} [${j.score}/10] ${v?.name || '—'} @ ${v?.employer?.name || '—'}`);
  console.log(`  Вердикт: ${j.reason}`);
  if (j.redFlags?.length) console.log(`  Red flags: ${j.redFlags.join('; ')}`);
}

async function main() {
  const argv = process.argv.slice(2);
  const resetJudgements = argv.includes('--reset-judgements');
  const force = argv.includes('--force');
  const idIdx = argv.indexOf('--id');
  const singleId = idIdx !== -1 ? String(argv[idIdx + 1]) : null;
  const dateArg = argv.find(a => /^\d{4}-\d{2}-\d{2}$/.test(a));
  const date = dateArg ? new Date(dateArg) : new Date();

  const cache = collectCache.load(date);
  log.info(`Cache: ${collectCache.fileFor(date)} (${Object.keys(cache.fullById).length} vacancies)`);

  const resume = loadResume();
  if (!resume) { log.error('RESUME_PATH not set'); process.exit(1); }
  if (!process.env.ANTHROPIC_API_KEY) { log.error('ANTHROPIC_API_KEY not set'); process.exit(1); }

  const cfg = loadConfig();
  const minScore = cfg.apply.minClaudeScore ?? 7;

  // --- Режим одной вакансии ---
  if (singleId) {
    const v = cache.fullById[singleId];
    if (!v) {
      log.error(`Vacancy ${singleId} not found in cache`);
      process.exit(1);
    }
    if (!force && cache.judgements[singleId]) {
      log.info('Already judged (use --force to re-judge)');
      printVerdict(v, cache.judgements[singleId]);
      return;
    }
    log.info(`Judging vacancy ${singleId}: ${v.name}`);
    const j = await judgeVacancy(resume, v, { minScore });
    if (!j) { log.error('Judge returned null'); process.exit(1); }
    cache.judgements[singleId] = j;
    collectCache.save(cache, date);
    printVerdict(v, j);
    return;
  }

  // --- Режим всех вакансий ---
  const vacancies = Object.values(cache.fullById);
  if (!vacancies.length) {
    log.error('No vacancies in cache. Run index.js first to collect them.');
    process.exit(1);
  }

  if (resetJudgements) {
    cache.judgements = {};
    collectCache.save(cache, date);
    log.info('Judgements reset');
  }

  const batchSize = parseInt(process.env.JUDGE_BATCH_SIZE || '10', 10);
  const pending = vacancies.filter(v => !cache.judgements[String(v.id)]);
  if (pending.length < vacancies.length)
    log.info(`Already judged (cached): ${vacancies.length - pending.length}`);
    log.info(`To judge: ${pending.length}`);

  let judged = 0;
  for (let i = 0; i < pending.length; i += batchSize) {
    const batch = pending.slice(i, i + batchSize);
    log.info(`Batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(pending.length / batchSize)}: ${batch.length} vacancies`);
    const result = await judgeVacanciesBatch(resume, batch, { minScore });
    if (!result) {
      log.warn('Batch failed, falling back to per-item judge');
      for (const v of batch) {
        const j = await judgeVacancy(resume, v, { minScore });
        if (j) { cache.judgements[String(v.id)] = j; collectCache.save(cache, date); }
        judged++;
      }
    } else {
      for (const [id, j] of result.entries()) cache.judgements[id] = j;
      collectCache.save(cache, date);
      judged += batch.length;
    }
  }

  const all = Object.entries(cache.judgements);
  const fit = all.filter(([, j]) => j.fit);
  const rejected = all.filter(([, j]) => !j.fit);
  log.info(`Done. Judged this run: ${judged} | fit=${fit.length}, rejected=${rejected.length}`);

  if (fit.length) {
    console.log('\n=== FIT VACANCIES ===');
    for (const [id, j] of fit.sort((a, b) => b[1].score - a[1].score)) {
      const v = cache.fullById[id];
      console.log(`[${j.score}/10] ${v?.name || id} @ ${v?.employer?.name || '—'} — ${j.reason}`);
    }
  }
}

main().catch(err => {
  log.error('Fatal', { msg: err.message, stack: err.stack });
  process.exit(1);
});
