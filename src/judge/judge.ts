import log from "../logger.js";
import { retryOnTransient } from "../retry.js";
import { loadConfig } from "../config";
import { getClient, buildResumeBlock } from "../ai-client.js";
import { stripHtml, parseJSON } from "../text-utils.js";
import { adaptResumeForVacancy } from "../adapt-resume.js";
import type { Vacancy, Resume, Verdict, JudgeOpts } from "../types.js";
import { buildSystemText } from "./system-text.js";

const apiConfig = loadConfig().api || {};

function formatVacancyText(vacancy: Vacancy) {
  const description = stripHtml(vacancy.description);
  const skills = (vacancy.key_skills || []).map(s => s.name).join(', ');
  const salary = vacancy.salary
    ? `${vacancy.salary.from || '?'}–${vacancy.salary.to || '?'} ${vacancy.salary.currency || ''}`
    : 'не указана';
  return `vacancyId: ${vacancy.id}
Название: ${vacancy.name}
Компания: ${vacancy.employer?.name || '—'}
Регион: ${vacancy.area?.name || '—'}
Опыт: ${vacancy.experience?.name || '—'}
График: ${vacancy.schedule?.name || '—'}
Занятость: ${vacancy.employment?.name || '—'}
Зарплата: ${salary}
Ключевые навыки: ${skills || '—'}

Описание:
${description}`;
}

async function judgeVacancy(resume: Resume, vacancy: Vacancy, opts: JudgeOpts = {}): Promise<Verdict | null> {
  const c = getClient(apiConfig);
  if (!c) return null;

  const model = process.env.CLAUDE_MODEL || 'gpt-4o';
  const minScore = opts.minScore ?? 7;

  const vacancyBlock = {
    type: 'text' as const,
    text: `=== ВАКАНСИЯ ===\n${formatVacancyText(vacancy)}`,
  };

  const adaptedText = opts.adaptResume ? adaptResumeForVacancy(resume, vacancy) : null;
  const resumeBlock = buildResumeBlock(resume, adaptedText);
  const systemText = buildSystemText(minScore);
  const messages: any = [
    { role: 'system' as const, content: systemText },
    {
      role: 'user' as const,
      content: [
        ...(resumeBlock ? [resumeBlock] : []),
        vacancyBlock,
      ],
    },
  ];
  try {
    const resp = await retryOnTransient(() => c.chat.completions.create({
      model,
      messages,
      response_format: { type: 'json_object' },
    }));
    const text = (resp as any).choices?.[0]?.message?.content;
    if (!text) return null;
    const parsed = parseJSON(text);
    log.debug(`judge ${vacancy.id}: score=${parsed.score} fit=${parsed.fit} in=${(resp as any).usage?.prompt_tokens} out=${(resp as any).usage?.completion_tokens}`);
    return parsed;
  } catch (err) {
    log.warn(`judge failed for ${vacancy.id}: ${err.message}`);
    return null;
  }
}

// Батчевая версия: судит пачку вакансий за один запрос.
// Возвращает Map<vacancyId, verdict> (verdict в том же формате, что judgeVacancy).
async function judgeVacanciesBatch(resume: Resume, vacancies: Vacancy[], opts: JudgeOpts = {}): Promise<Map<string, Verdict> | null> {
  const c = getClient(apiConfig);
  if (!c) return null;
  if (!vacancies.length) return new Map();

  const model = process.env.CLAUDE_MODEL;
  const minScore = opts.minScore ?? 7;
  const adapt = opts.adaptResume;

  const systemText = buildSystemText(minScore) +
    `\n\nВ этом запросе подаётся СРАЗУ НЕСКОЛЬКО вакансий. Для каждой верни отдельную запись в массиве verdicts с полем vacancyId, в том же порядке, что во входе.${adapt ? '\n\nДля каждой вакансии передано адаптированное под неё резюме — учитывай только его при оценке.' : ''}`;

  const vacanciesText = vacancies.map((v, i) => {
    let block = '';
    if (adapt) {
      const adapted = adaptResumeForVacancy(resume, v);
      if (adapted) {
        block += `=== АДАПТИРОВАННОЕ РЕЗЮМЕ (вакансия #${i + 1}) ===\n${adapted}\n\n`;
      }
    }
    block += `=== ВАКАНСИЯ #${i + 1} ===\n${formatVacancyText(v)}`;
    return block;
  }).join('\n\n');

  const resumeBlock = !adapt ? buildResumeBlock(resume) : null;

  const messages: any = [
    { role: 'system' as const, content: systemText },
    {
      role: 'user' as const,
      content: [
        ...(resumeBlock ? [resumeBlock] : []),
        { type: 'text' as const, text: vacanciesText },
      ],
    },
  ];

  try {
    const resp = await retryOnTransient(() => c.chat.completions.create({
      model,
      messages,
      response_format: { type: 'json_object' },
    }));
    const text = (resp as any).choices?.[0]?.message?.content;
    if (!text) return null;
    const parsed = parseJSON(text);

    log.debug(`judge batch ${vacancies.length}: in=${(resp as any).usage?.prompt_tokens || 0} out=${(resp as any).usage?.completion_tokens || 0}`);

    const map = new Map();
    for (const verdict of parsed.verdicts || []) {
      map.set(String(verdict.vacancyId), verdict);
    }
    return map;
  } catch (err) {
    log.warn(`judge batch failed (${vacancies.length} items): ${err.message}`);
    return null;
  }
}

export { judgeVacancy, judgeVacanciesBatch };
