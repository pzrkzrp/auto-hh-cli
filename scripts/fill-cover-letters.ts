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

  // Ищем самую свежую дату
  const dateDoc = await db.collection('cacheJudgements').findOne(
    {}, { sort: { date: -1 }, projection: { date: 1 } },
  );
  const date = dateDoc?.date;
  if (!date) {
    log.error('No judgements found in MongoDB');
    return;
  }

  // Загружаем judgements, fullById, coverLetters за эту дату
  const [judgeDocs, fullDocs, coverDocs] = await Promise.all([
    db.collection('cacheJudgements').find({ date }).toArray(),
    db.collection('cacheFull').find({ date }).toArray(),
    db.collection('cacheCoverLetters').find({ date }).toArray(),
  ]);

  const judgements: Record<string, any> = {};
  for (const d of judgeDocs) judgements[d.vacancyId] = d;

  const fullById: Record<string, any> = {};
  for (const d of fullDocs) fullById[d.vacancyId] = d.full;

  const coverLetters: Record<string, string> = {};
  for (const d of coverDocs) coverLetters[d.vacancyId] = d.letter;

  if (!Object.keys(judgements).length) {
    log.info('No judgements in cache');
    return;
  }

  // Отбираем approved вакансии без письма
  const missing = Object.entries(judgements)
    .filter(([id, j]) => j.fit && j.score >= minScore && !coverLetters[id])
    .map(([id, j]) => ({
      id,
      full: fullById[id],
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

  let generatedCount = 0;
  const generated = await buildCoverLettersBatch(resume, items, batchSize, async (partial) => {
    for (const [id, letter] of partial.entries()) {
      await db.collection('cacheCoverLetters').updateOne(
        { vacancyId: id },
        { $set: { date, vacancyId: id, letter } },
        { upsert: true },
      );
      generatedCount++;
    }
    log.info(`Progress: ${generatedCount}/${items.length} letters generated`);
  });

  // Обновляем digest — добавляем письма в entry.coverLetter
  const digest = await db.collection('digest').findOne({ date });
  if (digest?.entries) {
    let updated = 0;
    for (const entry of digest.entries) {
      if (!entry.coverLetter) {
        const cover = await db.collection('cacheCoverLetters').findOne({ vacancyId: String(entry.id) });
        if (cover?.letter) {
          entry.coverLetter = cover.letter;
          updated++;
        }
      }
    }
    if (updated) {
      await db.collection('digest').updateOne(
        { date },
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
