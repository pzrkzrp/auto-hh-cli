// Команда cover: сгенерировать сопроводительное для одной вакансии по id.
import HHClient from "../clients/hh-client";
import { buildCoverLetter } from "../domain/cover-letter/index.js";
import { loadResume } from "../resume.js";
import { loadConfig } from "../config.js";
import log from "../logger.js";

async function cover(vacancyId: string, opts: Record<string, any> = {}) {
  if (!vacancyId) {
    console.error('Usage: auto-hh cover <vacancy-id>');
    process.exit(1);
  }

  const cfg = loadConfig();
  const client = new HHClient();
  const resume = loadResume(opts.resume);

  try {
    if (!resume) {
      log.error('RESUME_PATH not set — resume required for cover letter');
      process.exit(1);
    }

    log.info(`Fetching vacancy ${vacancyId}...`);
    const full = await client.getVacancy(vacancyId);
    if (!full) {
      log.error(`Vacancy ${vacancyId} not found`);
      process.exit(1);
    }

    console.log(`\n=== ${full.name} @ ${full.employer?.name || '?'} ===`);
    console.log(`URL: ${full.alternate_url || `https://hh.ru/vacancy/${vacancyId}`}`);
    console.log(`Регион: ${full.area?.name || '—'}`);
    if (full.salary) {
      const parts = [];
      if (full.salary.from) parts.push(`от ${full.salary.from}`);
      if (full.salary.to) parts.push(`до ${full.salary.to}`);
      console.log(`Зарплата: ${parts.join(' ') || '?'} ${full.salary.currency || ''}`);
    }
    console.log();

    log.info(`Generating cover letter...`);
    const letter = await buildCoverLetter(cfg.apply.coverLetterTemplate, full);

    if (letter) {
      console.log('--- COVER LETTER ---');
      console.log(letter);
    } else {
      log.warn('No cover letter generated (API may be unavailable)');
    }
  } finally {
    await client.close?.();
  }
}

export default cover;
