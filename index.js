// Точка входа: ищем вакансии, фильтруем локально, потом Claude сравнивает с
// резюме и решает куда откликаться. На "fit" вакансии получаем уже
// сгенерированное Claude сопроводительное и кладём в дайджест.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const HHClient = require('./src/hh-client');
const { loadConfig } = require('./src/config');
const history = require('./src/history');
const { vacancyMatchesFilter } = require('./src/filter');
const { buildCoverLetter } = require('./src/cover-letter');
const { loadResume } = require('./src/resume');
const { judgeVacancy, judgeVacanciesBatch } = require('./src/judge');
const log = require('./src/logger');

async function collectVacancies(client, search) {
  const results = [];
  const maxPages = search.max_pages || 1;
  for (let page = 0; page < maxPages; page++) {
    const params = {
      text: search.text,
      area: search.area,
      experience: search.experience,
      salary: search.salary,
      only_with_salary: search.only_with_salary,
      currency: search.currency,
      per_page: search.per_page || 50,
      page,
    };
    if (search.schedule) params.schedule = search.schedule;
    if (search.employment) params.employment = search.employment;

    const data = await client.searchVacancies(params);
    log.info(`Page ${page}: ${data.items.length} vacancies (total ${data.found})`);
    results.push(...data.items);
    if (page + 1 >= (data.pages || 0)) break;
  }
  return results;
}

function fmtSalary(s) {
  if (!s) return '—';
  const parts = [];
  if (s.from) parts.push(`от ${s.from}`);
  if (s.to) parts.push(`до ${s.to}`);
  return `${parts.join(' ') || '?'} ${s.currency || ''}`.trim();
}

function writeDigest(entries) {
  const dir = path.join(__dirname, 'data');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `digest-${new Date().toISOString().slice(0, 10)}.md`);
  const md = entries.map(e => (
    `## ${e.title} — ${e.employer}\n` +
    `- Регион: ${e.area}\n` +
    `- Зарплата: ${e.salary}\n` +
    `- Скор Claude: ${e.score ?? '—'}/10\n` +
    `- Совпавшие навыки: ${e.matchedSkills.join(', ') || '—'}\n` +
    `- Вердикт: ${e.reason || '—'}\n` +
    `- Ссылка: ${e.url}\n\n` +
    `**Сопроводительное:**\n\n${e.coverLetter}\n\n---\n`
  )).join('\n');
  fs.writeFileSync(file, md);
  return file;
}

async function main() {
  const cfg = loadConfig();
  const client = new HHClient();
  const resume = loadResume();
  const minScore = cfg.apply.minClaudeScore ?? 7;

  try {
  if (resume) {
    log.info(`Resume loaded: ${resume.filename} (${resume.type})`);
  } else {
    log.warn('RESUME_PATH not set — Claude judge disabled, fall back to local filter only');
  }

  log.info('Searching vacancies', cfg.search);
  const items = await collectVacancies(client, cfg.search);

  // Этап 1: локальный фильтр — собираем кандидатов для Claude.
  const candidates = [];
  for (const item of items) {
    if (history.isSeen(item.id)) continue;

    let full;
    try {
      full = await client.getVacancy(item.id);
    } catch (err) {
      log.warn(`Failed to fetch vacancy ${item.id}: ${err.message}`);
      history.markSeen(item.id);
      continue;
    }

    const verdict = vacancyMatchesFilter(full, cfg.filter);
    history.markSeen(item.id);

    if (!verdict.ok) {
      log.info(`Skip ${item.id} (${full.name}): ${verdict.reason}`);
      continue;
    }
    candidates.push({ full, verdict });
  }

  log.info(`Local filter passed: ${candidates.length}/${items.length}`);

  // Этап 2: Claude судит пачками.
  const useClaude = resume && process.env.ANTHROPIC_API_KEY;
  const batchSize = parseInt(process.env.JUDGE_BATCH_SIZE || '10', 10);
  const judgements = new Map();
  let judgedCount = 0;

  if (useClaude && candidates.length) {
    for (let i = 0; i < candidates.length; i += batchSize) {
      const batch = candidates.slice(i, i + batchSize).map(c => c.full);
      log.info(`Judging batch ${i / batchSize + 1}: ${batch.length} vacancies`);
      const result = await judgeVacanciesBatch(resume, batch, { minScore });
      if (!result) {
        log.warn(`Batch failed, falling back to per-item judge`);
        for (const v of batch) {
          const j = await judgeVacancy(resume, v, { minScore });
          if (j) judgements.set(String(v.id), j);
          judgedCount++;
        }
      } else {
        for (const [id, j] of result.entries()) judgements.set(id, j);
        judgedCount += batch.length;
      }
    }
  }

  // Этап 3: финальный отбор.
  const matched = [];
  for (const { full, verdict } of candidates) {
    if (matched.length >= (cfg.apply.maxPerRun || 50)) break;

    let score = null, reason = '', coverLetter = null;

    if (useClaude) {
      const judgement = judgements.get(String(full.id));
      if (!judgement) {
        log.warn(`No judgement for ${full.id}, falling back to template`);
      } else {
        score = judgement.score;
        reason = judgement.reason;
        if (!judgement.fit) {
          log.info(`Claude rejected ${full.id} (score=${score}): ${reason}` +
            (judgement.redFlags?.length ? ` flags=${judgement.redFlags.join('; ')}` : ''));
          continue;
        }
        coverLetter = judgement.coverLetter;
        log.info(`Claude approved ${full.id} (score=${score}): ${reason}`);
      }
    }

    if (!coverLetter) {
      coverLetter = await buildCoverLetter(cfg.apply.coverLetterTemplate, full, verdict.matchedSkills);
    }

    matched.push({
      id: full.id,
      title: full.name,
      employer: full.employer?.name || '—',
      area: full.area?.name || '—',
      salary: fmtSalary(full.salary),
      url: full.alternate_url,
      matchedSkills: verdict.matchedSkills,
      score,
      reason,
      coverLetter,
    });
    history.markApplied(full.id, {
      title: full.name,
      employer: full.employer?.name,
      url: full.alternate_url,
      score,
      digestOnly: true,
    });
    log.info(`Match: ${full.name} @ ${full.employer?.name} -> ${full.alternate_url}`);
  }

  log.info(`Judged by Claude: ${judgedCount}, accepted: ${matched.length}`);

  if (matched.length === 0) {
    log.info('No matching vacancies.');
    return;
  }

  const file = writeDigest(matched);
  log.info(`Digest saved: ${file} (${matched.length} vacancies)`);
  console.log('\n=== TOP MATCHES ===');
  for (const e of matched.slice(0, 10)) {
    console.log(`- [${e.score ?? '?'}/10] ${e.title} @ ${e.employer} | ${e.salary}\n  ${e.url}`);
  }
  } finally {
    await client.close?.();
  }
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    log.error('Fatal', { msg: err.message, stack: err.stack });
    process.exit(1);
  });
