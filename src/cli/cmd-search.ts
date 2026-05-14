// Команда search: поиск, фильтр, Claude → дайджест.
import path from "path";
import HHClient from "../hh-client.js";
import {  loadConfig  } from "../config.js";
import history from "../history.js";
import collectCache from "../cache.js";
import {  vacancyMatchesFilter  } from "../filter.js";
import {  buildCoverLetter, buildCoverLettersBatch  } from "../cover-letter.js";
import {  loadResume  } from "../resume.js";
import {  judgeVacancy, judgeVacanciesBatch  } from "../judge.js";
import {  writeDigest, writeRejected  } from "../digest.js";
import resetData from "../reset.js";
import log from "../logger.js";

async function collectVacancies(client, search, cache) {
  const results = [];
  const startPage = search.start_page || 0;
  const maxPages = search.max_pages || 1;
  for (let page = startPage; page < startPage + maxPages; page++) {
    const cached = cache.pages[String(page)];
    if (cached) {
      log.info(`Page ${page}: ${cached.length} vacancies (cached)`);
      results.push(...cached);
      continue;
    }

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
    cache.pages[String(page)] = data.items;
    collectCache.save(cache);
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

async function filterLocally(client, items, cache, cfg) {
  const candidates = [];
  for (const item of items) {
    let full = cache.fullById[String(item.id)];
    if (!full) {
      if (history.isSeen(item.id)) continue;
      try {
        full = await client.getVacancy(item.id);
      } catch (err) {
        log.warn(`Failed to fetch vacancy ${item.id}: ${err.message}`);
        history.markSeen(item.id);
        continue;
      }
      if (!full) {
        log.warn(`Empty vacancy ${item.id}, skipping`);
        history.markSeen(item.id);
        continue;
      }
      cache.fullById[String(item.id)] = full;
      collectCache.save(cache);
    }

    const verdict = vacancyMatchesFilter(full, cfg.filter);
    history.markSeen(item.id);

    if (!verdict.ok) {
      log.info(`Skip ${item.id} (${full.name}): ${verdict.reason}`);
      continue;
    }
    candidates.push({ full, verdict });
  }
  return candidates;
}

async function judgeWithClaude(resume, candidates, cache, minScore) {
  const judgements = new Map();
  for (const [id, j] of Object.entries(cache.judgements)) judgements.set(id, j);
  let judgedCount = 0;

  const pending = candidates.filter(c => !judgements.has(String(c.full.id)));
  if (pending.length < candidates.length) {
    log.info(`Judgements from cache: ${candidates.length - pending.length}/${candidates.length}`);
  }

  const batchSize = parseInt(process.env.JUDGE_BATCH_SIZE || '10', 10);
  const batches = [];
  for (let i = 0; i < pending.length; i += batchSize) {
    batches.push(pending.slice(i, i + batchSize).map(c => c.full));
  }

  let nextBatchIdx = 0;
  const CONCURRENCY = 1;

  async function runBatch(idx, batch) {
    log.info(`Judging batch ${idx}: ${batch.length} vacancies`);
    const result = await judgeVacanciesBatch(resume, batch, { minScore });
    if (!result) {
      log.warn(`Batch ${idx} failed, falling back to per-item judge`);
      for (const v of batch) {
        const j = await judgeVacancy(resume, v, { minScore });
        if (j) {
          judgements.set(String(v.id), j);
          cache.judgements[String(v.id)] = j;
          collectCache.save(cache);
        }
        judgedCount++;
      }
    } else {
      for (const [id, j] of result.entries()) {
        judgements.set(id, j);
        cache.judgements[id] = j;
      }
      collectCache.save(cache);
      judgedCount += batch.length;
    }
  }

  async function worker() {
    while (nextBatchIdx < batches.length) {
      const batch = batches[nextBatchIdx];
      const num = nextBatchIdx + 1;
      nextBatchIdx++;
      await runBatch(num, batch);
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batches.length) }, () => worker()));
  return { judgements, judgedCount };
}

function selectAccepted(candidates, judgements, useClaude, maxRun) {
  const accepted = [];
  const rejected = [];
  for (const { full, verdict } of candidates) {
    if (accepted.length >= maxRun) break;

    let score = null, reason = '';

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
          rejected.push({
            id: full.id,
            title: full.name,
            employer: full.employer?.name || '—',
            area: full.area?.name || '—',
            salary: fmtSalary(full.salary),
            url: full.alternate_url,
            score,
            reason,
            redFlags: judgement.redFlags || [],
          });
          continue;
        }
        log.info(`Claude approved ${full.id} (score=${score}): ${reason}`);
      }
    }

    accepted.push({ full, verdict, score, reason });
  }
  return { accepted, rejected };
}

async function generateCoverLetters(resume, accepted, cache, dryRun) {
  const coverBatchSize = parseInt(process.env.COVER_BATCH_SIZE || '20', 10);
  const coverMap = new Map();
  for (const [id, letter] of Object.entries(cache.coverLetters)) coverMap.set(id, letter);

  if (!dryRun && accepted.length) {
    const pending = accepted.filter(a => !coverMap.has(String(a.full.id)));
    if (pending.length < accepted.length) {
      log.info(`Cover letters from cache: ${accepted.length - pending.length}/${accepted.length}`);
    }
    if (pending.length) {
      log.info(`Generating cover letters in batches of ${coverBatchSize} for ${pending.length} vacancies`);
      const generated = await buildCoverLettersBatch(
        resume,
        pending.map(a => ({ vacancy: a.full, matchedSkills: a.verdict.matchedSkills })),
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
  }

  return coverMap;
}

async function buildResults(accepted, coverMap, cache, cfg) {
  const matched = [];
  for (const a of accepted) {
    const { full, verdict, score, reason } = a;
    let coverLetter = coverMap.get(String(full.id));
    if (!coverLetter) {
      coverLetter = buildCoverLetter(cfg.apply.coverLetterTemplate, full, verdict.matchedSkills);
      if (coverLetter) {
        cache.coverLetters[String(full.id)] = coverLetter;
        collectCache.save(cache);
      }
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
  return matched;
}

async function search(opts = {}) {
  if (opts.config) process.env.CONFIG_PATH = opts.config;
  if (opts.reset) {
    resetData();
  }

  const cfg = loadConfig();
  const client = new HHClient();
  const resume = loadResume();
  const minScore = cfg.apply.minClaudeScore ?? 7;
  const dryRun = opts.dryRun ?? cfg.apply.dryRun ?? false;
  const hasApiKey = cfg.api?.apiKey || process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY;
  const useClaude = resume && hasApiKey && opts.claude !== false;
  const maxRun = cfg.apply.maxPerRun || 50;

  try {
    if (resume) {
      log.info(`Resume loaded: ${resume.filename} (${resume.type})`);
    } else {
      log.warn('RESUME_PATH not set — Claude judge disabled, fall back to local filter only');
    }

    log.info('Searching vacancies', cfg.search);
    const cache = collectCache.load();
    const items = await collectVacancies(client, cfg.search, cache);

    const candidates = await filterLocally(client, items, cache, cfg);
    log.info(`Local filter passed: ${candidates.length}/${items.length}`);

    const { judgements, judgedCount } = useClaude
      ? await judgeWithClaude(resume, candidates, cache, minScore)
      : { judgements: new Map(), judgedCount: 0 };

    const { accepted, rejected } = selectAccepted(candidates, judgements, useClaude, maxRun);

    const coverMap = await generateCoverLetters(resume, accepted, cache, dryRun);

    const matched = await buildResults(accepted, coverMap, cache, cfg);

    log.info(`Judged by Claude: ${judgedCount}, accepted: ${matched.length}, rejected: ${rejected.length}`);

    const rejectedFile = writeRejected(rejected);
    if (rejectedFile) log.info(`Rejected saved: ${rejectedFile} (${rejected.length} vacancies)`);

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

export default search;
