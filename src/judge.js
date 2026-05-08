// Claude-судья: получает резюме + описание вакансии,
// решает стоит ли откликаться и сразу пишет персональное сопроводительное.
//
// Возвращает: { fit: boolean, score: 1..10, reason, redFlags, coverLetter? }
// Резюме отправляется один раз, кешируется (cache_control) — на каждой
// следующей вакансии оплачивается только дешёвое чтение кеша.
const log = require('./logger');

let client = null;
function getClient() {
  if (client) return client;
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const Anthropic = require('@anthropic-ai/sdk');
  client = Anthropic.default ? new Anthropic.default() : new Anthropic();
  return client;
}

function stripHtml(s) {
  return (s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

// Резюме как кешируемый блок. PDF идёт документом, текст — текстом.
function buildResumeBlock(resume) {
  if (!resume) return null;
  if (resume.type === 'pdf') {
    return {
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: resume.data },
      title: resume.filename,
      cache_control: { type: 'ephemeral' },
    };
  }
  return {
    type: 'text',
    text: `=== РЕЗЮМЕ СОИСКАТЕЛЯ ===\n${resume.text}`,
    cache_control: { type: 'ephemeral' },
  };
}

const JUDGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    fit: { type: 'boolean', description: 'Стоит ли откликаться' },
    score: { type: 'integer', description: 'Соответствие резюме вакансии, 1..10' },
    reason: { type: 'string', description: '1-2 предложения почему' },
    redFlags: {
      type: 'array',
      items: { type: 'string' },
      description: 'Несоответствия: стек, опыт, локация, ЗП и т.п.',
    },
    coverLetter: {
      type: 'string',
      description: 'Если fit=true — короткое сопроводительное (4-6 предложений) от первого лица. Иначе пустая строка.',
    },
  },
  required: ['fit', 'score', 'reason', 'redFlags', 'coverLetter'],
};

async function judgeVacancy(resume, vacancy, opts = {}) {
  const c = getClient();
  if (!c) return null;

  const model = process.env.CLAUDE_MODEL || 'claude-opus-4-7';
  const minScore = opts.minScore ?? 7;

  const description = stripHtml(vacancy.description).slice(0, 6000);
  const skills = (vacancy.key_skills || []).map(s => s.name).join(', ');
  const salary = vacancy.salary
    ? `${vacancy.salary.from || '?'}–${vacancy.salary.to || '?'} ${vacancy.salary.currency || ''}`
    : 'не указана';

  const vacancyBlock = {
    type: 'text',
    text: `=== ВАКАНСИЯ ===
Название: ${vacancy.name}
Компания: ${vacancy.employer?.name || '—'}
Регион: ${vacancy.area?.name || '—'}
Опыт: ${vacancy.experience?.name || '—'}
График: ${vacancy.schedule?.name || '—'}
Занятость: ${vacancy.employment?.name || '—'}
Зарплата: ${salary}
Ключевые навыки: ${skills || '—'}

Описание:
${description}`,
  };

  const resumeBlock = buildResumeBlock(resume);

  const systemText = `Ты карьерный консультант. Сравни резюме соискателя с вакансией и реши, стоит ли откликаться.

Критерии "fit=true":
- Стек на 60%+ совпадает с требованиями
- Уровень (junior/middle/senior) подходит
- Нет блокирующих несоответствий: обязательная локация, технология, которой нет в резюме, и т.п.
- Зарплатная вилка не ниже ожиданий из резюме (если указано)

score: 1-3 — не подходит, 4-6 — спорно, 7-8 — хороший матч, 9-10 — идеальный.
Порог отклика: score >= ${minScore}. Если ниже — fit=false.

Если fit=true — напиши сопроводительное (4-6 предложений) от первого лица: упомяни 1-2 конкретных пункта из вакансии, релевантный опыт из резюме, без воды и markdown. Начни с "Здравствуйте!", закончи "С уважением.".
Если fit=false — coverLetter="".`;

  const messages = [
    {
      role: 'user',
      content: [
        ...(resumeBlock ? [resumeBlock] : []),
        vacancyBlock,
      ],
    },
  ];

  try {
    const resp = await c.messages.create({
      model,
      max_tokens: 1500,
      system: [{ type: 'text', text: systemText, cache_control: { type: 'ephemeral' } }],
      messages,
      output_config: {
        format: { type: 'json_schema', schema: JUDGE_SCHEMA },
      },
    });

    const block = resp.content.find(b => b.type === 'text');
    if (!block) return null;
    const parsed = JSON.parse(block.text);

    log.debug(`judge ${vacancy.id}: score=${parsed.score} fit=${parsed.fit} cache_read=${resp.usage.cache_read_input_tokens || 0}`);
    return parsed;
  } catch (err) {
    log.warn(`judge failed for ${vacancy.id}: ${err.message}`);
    return null;
  }
}

module.exports = { judgeVacancy };
