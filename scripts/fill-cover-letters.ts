#!/usr/bin/env node
// @ts-nocheck
// Проходит по cache.coverLetters, находит пустые, генерирует заново
// и обновляет дайджест.
import 'dotenv/config';
import { connect, dbInstance } from "../src/db.js";
import { buildCoverLettersBatch, buildCoverLetter } from "../src/cover-letter.js";
import { loadResume } from "../src/resume.js";
import { loadConfig } from "../src/config.js";
import log from "../src/logger.js";

const cfg = loadConfig();
const resume = loadResume();
const minScore = cfg.apply.minClaudeScore ?? 7;

async function main() {
  if (!resume) {
    log.error('RESUME_PATH not set');
    process.exit(1);
  }

  await connect();
  const db = dbInstance();

  // Ищем самый свежий документ cache
  const cache = await db.collection('cache').findOne({}, { sort: { date: -1 } });
  if (!cache) {
    log.error('No cache found in MongoDB');
    process.exit(1);
  }

  const { judgements, coverLetters, fullById } = cache;
  if (!judgements || !Object.keys(judgements).length) {
    log.info('No judgements in cache');
    return;
  }

  // Отбираем approved вакансии без письма
  const missing = Object.entries(judgements)
    .filter(([id, j]) => j.fit && j.score >= minScore && !coverLetters?.[id])
    .map(([id, j]) => ({
      id,
      full: fullById?.[id],
      judgement: j,
    }));

  if (!missing.length) {
    log.info('All approved vacancies already have cover letters');
    return;
  }

  log.info(`Found ${missing.length} vacancies without cover letter`);

  // Генерируем пачками
  const items = missing
    .filter(m => m.full)
    .map(m => ({ vacancy: m.full, matchedSkills: [] }));
  const batchSize = parseInt(process.env.COVER_BATCH_SIZE || '10', 10);

  const generated = await buildCoverLettersBatch(resume, items, batchSize, async (partial) => {
    // Сохраняем прогресс в cache
    for (const [id, letter] of partial.entries()) {
      cache.coverLetters[id] = letter;
    }
    await db.collection('cache').updateOne(
      { date: cache.date },
      { $set: { coverLetters: cache.coverLetters } },
    );
    log.info(`Progress: ${partial.size}/${items.length} letters generated`);
  });

  // Обновляем cache финально
  for (const [id, letter] of generated.entries()) {
    cache.coverLetters[id] = letter;
  }
  await db.collection('cache').updateOne(
    { date: cache.date },
    { $set: { coverLetters: cache.coverLetters } },
  );

  // Обновляем digest — добавляем письма в entry.coverLetter
  const digest = await db.collection('digest').findOne({ date: cache.date });
  if (digest?.entries) {
    let updated = 0;
    for (const entry of digest.entries) {
      const letter = cache.coverLetters[String(entry.id)];
      if (letter && !entry.coverLetter) {
        entry.coverLetter = letter;
        updated++;
      }
    }
    if (updated) {
      await db.collection('digest').updateOne(
        { date: cache.date },
        { $set: { entries: digest.entries } },
      );
      log.info(`Digest updated: ${updated} cover letters added`);
    }
  }

  log.info(`Done. ${generated.size} cover letters generated`);
}

main().catch(err => {
  log.error('Fatal', { msg: err.message });
  process.exit(1);
});
