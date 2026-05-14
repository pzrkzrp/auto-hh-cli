#!/usr/bin/env node
// @ts-nocheck
// Собирает digest из сегодняшнего кэша: фильтр → judge → cover letters → digest.
// Не ходит в hh.ru, использует только кэшированные данные.
import 'dotenv/config';
import fs from "fs";
import path from "path";

import collectCache from "../src/cache.js";
import {  loadResume  } from "../src/resume.js";
import {  loadConfig  } from "../src/config.js";
import {  vacancyMatchesFilter  } from "../src/filter.js";
import {  judgeVacancy, judgeVacanciesBatch  } from "../src/judge.js";
import {  buildCoverLettersBatch, buildCoverLetter  } from "../src/cover-letter.js";
import log from "../src/logger.js";

function fmtSalary(s) {
  if (!s) return '—';
  const parts = [];
  if (s.from) parts.push(`от ${s.from}`);
  if (s.to) parts.push(`до ${s.to}`);
  return `${parts.join(' ') || '?'} ${s.currency || ''}`.trim();
}

function writeDigest(entries) {
  const dir = path.join(__dirname, '..', 'data');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `digest-${new Date().toISOString().slice(0, 10)}.md`);
  const md = entries.map(e =>
    `## ${e.title} — ${e.employer}\n` +
    `- Регион: ${e.area}\n` +
    `- Зарплата: ${e.salary}\n` +
    `- Скор Claude: ${e.score ?? '—'}/10\n` +
    `- Совпавшие навыки: ${e.matchedSkills.join(', ') || '—'}\n` +
    `- Вердикт: ${e.reason || '—'}\n` +
    `- Ссылка: ${e.url}\n\n` +
    `**Сопроводительное:**\n\n${e.coverLetter || '*не сгенерировано*'}\n\n---\n`
  ).join('\n');
  fs.writeFileSync(file, md);
  return file;
}

function writeRejected(entries) {
  if (!entries.length) return null;
  const dir = path.join(__dirname, '..', 'data');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `rejected-${new Date().toISOString().slice(0, 10)}.md`);
  const md = entries.map(e =>
    `## ${e.title} — ${e.employer}\n` +
    `- Регион: ${e.area}\n` +
    `- Зарплата: ${e.salary}\n` +
    `- Скор Claude: ${e.score ?? '—'}/10\n` +
    `- Red flags: ${e.redFlags?.join('; ') || '—'}\n` +
    `- Вердикт: ${e.reason || '—'}\n` +
    `- Ссылка: ${e.url}\n\n---\n`
  ).join('\n');
  fs.writeFileSync(file, md);
  return file;
}

async function main() {
  const cache = collectCache.load();
  const resume = loadResume();
  const cfg = loadConfig();
  const minScore = cfg.apply.minClaudeScore ?? 7;
  const coverLetterTemplate = cfg.apply.coverLetterTemplate;
  const maxPerRun = cfg.apply.maxPerRun || 50;

  const vacancies = Object.values(cache.fullById);
  log.info(`Cache: ${collectCache.fileFor()} (${vacancies.length} vacancies, ${Object.keys(cache.judgements).length} judgements)`);

  // Этап 1: локальный фильтр
  const candidates = [];
  for (const v of vacancies) {
    const verdict = vacancyMatchesFilter(v, cfg.filter);
    if (!verdict.ok) continue;
    candidates.push({ full: v, verdict });
  }
  log.info(`Local filter passed: ${candidates.length}/${vacancies.length}`);

  if (!candidates.length) {
    log.info('No candidates after filter.');
    return;
  }

  // Этап 2: judge — только те, кого нет в кэше
  const judgements = new Map();
  for (const [id, j] of Object.entries(cache.judgements)) judgements.set(id, j);
  const pending = candidates.filter(c => !judgements.has(String(c.full.id)));
  const batchSize = parseInt(process.env.JUDGE_BATCH_SIZE || '10', 10);

  if (pending.length) {
    log.info(`Judging ${pending.length} uncached vacancies (batch size ${batchSize})...`);
    for (let i = 0; i < pending.length; i += batchSize) {
      const batch = pending.slice(i, i + batchSize).map(c => c.full);
      const result = await judgeVacanciesBatch(resume, batch, { minScore });
      if (!result) {
        log.warn('Batch failed, per-item fallback');
        for (const v of batch) {
          const j = await judgeVacancy(resume, v, { minScore });
          if (j) {
            judgements.set(String(v.id), j);
            cache.judgements[String(v.id)] = j;
            collectCache.save(cache);
          }
        }
      } else {
        for (const [id, j] of result.entries()) {
          judgements.set(id, j);
          cache.judgements[id] = j;
        }
        collectCache.save(cache);
      }
    }
  } else {
    log.info('All candidates already judged (cached).');
  }

  // Этап 3: разделяем fit / rejected
  const accepted = [];
  const rejected = [];
  for (const { full, verdict } of candidates) {
    if (accepted.length >= maxPerRun) break;
    const j = judgements.get(String(full.id));
    if (!j) {
      log.warn(`No judgement for ${full.id}, skipping`);
      continue;
    }
    if (!j.fit) {
      rejected.push({
        id: full.id, title: full.name,
        employer: full.employer?.name || '—',
        area: full.area?.name || '—',
        salary: fmtSalary(full.salary),
        url: full.alternate_url,
        score: j.score, reason: j.reason,
        redFlags: j.redFlags || [],
      });
      continue;
    }
    accepted.push({ full, verdict, score: j.score, reason: j.reason });
  }
  log.info(`Claude: ${accepted.length} fit, ${rejected.length} rejected`);

  // Этап 4: cover letters
  const coverMap = new Map();
  for (const [id, letter] of Object.entries(cache.coverLetters)) coverMap.set(id, letter);
  const needLetter = accepted.filter(a => !coverMap.has(String(a.full.id)));

  if (needLetter.length && resume) {
    log.info(`Generating ${needLetter.length} cover letters...`);
    const coverBatchSize = parseInt(process.env.COVER_BATCH_SIZE || '20', 10);
    const generated = await buildCoverLettersBatch(
      resume,
      needLetter.map(a => ({ vacancy: a.full, matchedSkills: a.verdict.matchedSkills })),
      coverBatchSize,
      (partial) => {
        for (const [id, letter] of partial.entries()) {
          coverMap.set(id, letter);
          cache.coverLetters[id] = letter;
        }
        collectCache.save(cache);
      },
    );
    for (const [id, letter] of generated.entries()) coverMap.set(id, letter);
  }

  // Этап 5: собираем digest
  const matched = [];
  for (const a of accepted) {
    const { full, verdict, score, reason } = a;
    let letter = coverMap.get(String(full.id));
    if (!letter) {
      letter = buildCoverLetter(coverLetterTemplate, full, verdict.matchedSkills);
      if (letter) {
        cache.coverLetters[String(full.id)] = letter;
        collectCache.save(cache);
      }
    }
    matched.push({
      id: full.id, title: full.name,
      employer: full.employer?.name || '—',
      area: full.area?.name || '—',
      salary: fmtSalary(full.salary),
      url: full.alternate_url,
      matchedSkills: verdict.matchedSkills,
      score, reason, coverLetter: letter,
    });
  }

  const rejFile = writeRejected(rejected);
  if (rejFile) log.info(`Rejected: ${rejFile} (${rejected.length})`);

  const digFile = writeDigest(matched);
  log.info(`Digest: ${digFile} (${matched.length} vacancies)`);

  console.log('\n=== TOP MATCHES ===');
  for (const e of matched.slice(0, 10)) {
    console.log(`- [${e.score ?? '?'}/10] ${e.title} @ ${e.employer} | ${e.salary}\n  ${e.url}`);
  }

  if (rejected.length) {
    console.log(`\nRejected: ${rejected.length} vacancies`);
    for (const e of rejected.slice(0, 5)) {
      console.log(`- [${e.score}/10] ${e.title} — ${e.reason}`);
    }
  }
}

main().catch(err => {
  log.error('Fatal', { msg: err.message, stack: err.stack });
  process.exit(1);
});
