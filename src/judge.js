const log = require('./logger');
const { retryOnTransient } = require('./retry');
const { loadConfig } = require('./config');
const { getClient, stripHtml, parseJSON, buildResumeBlock } = require('./claude');

const apiConfig = loadConfig().api || {};

// const JUDGE_SCHEMA = {
//   type: 'object',
//   additionalProperties: false,
//   properties: {
//     vacancyId: { type: 'string', description: 'id вакансии' },
//     fit: { type: 'boolean', description: 'Стоит ли откликаться' },
//     score: { type: 'integer', description: 'Соответствие резюме вакансии, 1..10' },
//     reason: { type: 'string', description: '1-2 предложения почему' },
//     redFlags: {
//       type: 'array',
//       items: { type: 'string' },
//       description: 'Несоответствия: стек, опыт, локация, ЗП и т.п.',
//     },
//     coverLetter: {
//       type: 'string',
//       description: 'Если fit=true — короткое сопроводительное (4-6 предложений) от первого лица. Иначе пустая строка.',
//     },
//   },
//   required: ['vacancyId', 'fit', 'score', 'reason', 'redFlags', 'coverLetter'],
// };
//
// const BATCH_JUDGE_SCHEMA = {
//   type: 'object',
//   additionalProperties: false,
//   properties: {
//     verdicts: {
//       type: 'array',
//       description: 'По одной записи на каждую вакансию в том же порядке, что во входе.',
//       items: {
//         type: 'object',
//         additionalProperties: false,
//         properties: {
//           vacancyId: { type: 'string', description: 'id вакансии из входа' },
//           fit: { type: 'boolean' },
//           score: { type: 'integer' },
//           reason: { type: 'string' },
//           redFlags: { type: 'array', items: { type: 'string' } },
//           coverLetter: { type: 'string' },
//         },
//         required: ['vacancyId', 'fit', 'score', 'reason', 'redFlags', 'coverLetter'],
//       },
//     },
//   },
//   required: ['verdicts'],
// };

function formatVacancyText(vacancy) {
  const description = stripHtml(vacancy.description).slice(0, 6000);
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

function buildSystemText(minScore) {
  return `Ты карьерный консультант. Сравни резюме соискателя с вакансией и реши, стоит ли откликаться.

Критерии "fit=true":
- Стек на 60%+ совпадает с требованиями
- Уровень (junior/middle/senior) подходит
- Нет блокирующих несоответствий: обязательная локация, технология, которой нет в резюме, и т.п.
- Зарплатная вилка не ниже ожиданий из резюме (если указано)

score: 1-3 — не подходит, 4-6 — спорно, 7-8 — хороший матч, 9-10 — идеальный.
Порог отклика: score >= ${minScore}. Если ниже — fit=false.
Если fit = false, добавь поле reason с причиной отказа.
Если fit = true, добавь поле comment почему вакансия подходит.
coverLetter всегда оставляй пустой строкой "" — сопроводительные пишутся отдельным шагом.
vacancyId скопируй из поля id вакансии (оно первое в данных вакансии).ла
Отвечай ТОЛЬКО JSON, строго соответствующий этой схеме.
Никаких пояснений, никакого markdown, только один JSON-объект.`;
}

async function judgeVacancy(resume, vacancy, opts = {}) {
  const c = getClient(apiConfig);
  if (!c) return null;

  const model = process.env.CLAUDE_MODEL || 'gpt-4o';
  const minScore = opts.minScore ?? 7;

  const vacancyBlock = {
    type: 'text',
    text: `=== ВАКАНСИЯ ===\n${formatVacancyText(vacancy)}`,
  };

  const resumeBlock = buildResumeBlock(resume);
  const systemText = buildSystemText(minScore);
  const messages = [
    { role: 'system', content: systemText },
    {
      role: 'user',
      content: [
        ...(resumeBlock ? [resumeBlock] : []),
        vacancyBlock,
      ],
    },
  ];
  try {
    const resp = await retryOnTransient(() => c.chat.completions.create({
      model,
      max_tokens: 8000,
      messages,
      response_format: { type: 'json_object' },
    }));
    const text = resp.choices?.[0]?.message?.content;
    if (!text) return null;
    const parsed = parseJSON(text);
    log.debug(`judge ${vacancy.id}: score=${parsed.score} fit=${parsed.fit} in=${resp.usage?.prompt_tokens} out=${resp.usage?.completion_tokens}`);
    return parsed;
  } catch (err) {
    log.warn(`judge failed for ${vacancy.id}: ${err.message}`);
    return null;
  }
}

// Батчевая версия: судит пачку вакансий за один запрос.
// Возвращает Map<vacancyId, verdict> (verdict в том же формате, что judgeVacancy).
async function judgeVacanciesBatch(resume, vacancies, opts = {}) {
  const c = getClient(apiConfig);
  if (!c) return null;
  if (!vacancies.length) return new Map();

  const model = process.env.CLAUDE_MODEL || 'gpt-4o';
  const minScore = opts.minScore ?? 7;

  const resumeBlock = buildResumeBlock(resume);
  const systemText = buildSystemText(minScore) +
    `\n\nВ этом запросе подаётся СРАЗУ НЕСКОЛЬКО вакансий. Для каждой верни отдельную запись в массиве verdicts с полем vacancyId, в том же порядке, что во входе.`;

  const vacanciesText = vacancies.map((v, i) =>
    `=== ВАКАНСИЯ #${i + 1} ===\n${formatVacancyText(v)}`
  ).join('\n\n');

  const messages = [
    { role: 'system', content: systemText },
    {
      role: 'user',
      content: [
        ...(resumeBlock ? [resumeBlock] : []),
        { type: 'text', text: vacanciesText },
      ],
    },
  ];

  try {
    const resp = await retryOnTransient(() => c.chat.completions.create({
      model,
      max_tokens: 8000,
      messages,
      response_format: { type: 'json_object' },
    }));
    console.log(resp)
    const text = resp.choices?.[0]?.message?.content;
    if (!text) return null;
    const parsed = parseJSON(text);
    console.dir({parsed}, {depth: null})

    log.debug(`judge batch ${vacancies.length}: in=${resp.usage?.prompt_tokens || 0} out=${resp.usage?.completion_tokens || 0}`);

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

module.exports = { judgeVacancy, judgeVacanciesBatch };
