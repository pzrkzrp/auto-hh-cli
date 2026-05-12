// Генерация сопроводительного письма.
// Если задан ANTHROPIC_API_KEY — Claude пишет персональное письмо
// на основе описания вакансии и профиля соискателя из .env.
// Иначе — fallback на шаблон из config.json с плейсхолдерами:
//   {title}, {employer}, {matchedSkills}, {area}.
const log = require('./logger');

let anthropic = null;
function getClient() {
  if (anthropic) return anthropic;
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const Anthropic = require('@anthropic-ai/sdk');
  anthropic = new Anthropic.default ? new Anthropic.default() : new Anthropic();
  return anthropic;
}

function buildFromTemplate(template, vacancy, matchedSkills) {
  const ctx = {
    title: vacancy.name || '',
    employer: vacancy.employer?.name || '',
    area: vacancy.area?.name || '',
    matchedSkills: (matchedSkills && matchedSkills.length)
      ? matchedSkills.join(', ')
      : 'требуемыми технологиями',
  };
  return template.replace(/\{(\w+)\}/g, (_, k) => ctx[k] ?? '');
}

// Чистим html-разметку из vacancy.description.
function stripHtml(s) {
  return (s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

async function buildWithClaude(vacancy, matchedSkills) {
  const client = getClient();
  if (!client) return null;

  const profile = process.env.APPLICANT_PROFILE || 'опытный разработчик';
  const model = process.env.CLAUDE_MODEL || 'claude-opus-4-7';

  const description = stripHtml(vacancy.description).slice(0, 4000);
  const skills = (vacancy.key_skills || []).map(s => s.name).join(', ');

  const userMsg = `Вакансия: ${vacancy.name}
Компания: ${vacancy.employer?.name || '—'}
Регион: ${vacancy.area?.name || '—'}
Ключевые навыки: ${skills || '—'}
Совпавшие с моими: ${matchedSkills?.join(', ') || '—'}

Описание:
${description}

Напиши сопроводительное письмо от моего имени, 5–7 предложений. Ориентируйся на этот образец по тону и ритму:

"""
Увидел вашу вакансию — стек прям полностью совпадает, решил написать. Я фуллстек, последние пару лет пишу на React + NestJS. С SQL и ORM (чаще TypeORM и Prisma) работаю каждый день, Next.js тоже трогал, пару проектов с SSR было. Задачи знакомые: архитектуру обсуждал, приложения с нуля заводил, легаси подшаманивал. Удалёнка по Мск идеально, я живу в этом же часовом поясе. Можем созвониться, расскажу подробнее.
"""

Правила:
- Живой разговорный тон, как будто человек быстро набрал в чат. Короткие фразы, тире, скобки — ок.
- Лёгкая неформальность: "трогал", "подшаманивал", "прям", "идеально" — такие словечки допустимы и желательны.
- Без канцелярита и шаблонов ("рассмотрите мою кандидатуру", "готов внести вклад", "имею опыт", "считаю себя", "мои сильные стороны").
- Не прилизывай — пусть читается как живое сообщение, а не сочинение.
- Первая фраза — крюк за конкретику вакансии ("увидел...", "наткнулся на...", "стек совпадает...").
- Упомяни 1–2 конкретных совпадения из описания.
- Без markdown, без подписи "С уважением".
- Начни с "Привет!" или "Здравствуйте!" (можно и без приветствия, как в образце).
- Заверши строкой "Telegram: @your_telegram".`;

  try {
    const resp = await client.messages.create({
      model,
      max_tokens: 800,
      system: [
        {
          type: 'text',
          text: `Ты помогаешь соискателю писать сопроводительные письма для откликов на hh.ru. Профиль соискателя: ${profile}\n\nПиши лаконично, по-человечески, без канцелярита. Цель — убедить рекрутера открыть резюме.`,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [{ role: 'user', content: userMsg }],
    });
    const text = resp.content.find(b => b.type === 'text')?.text?.trim();
    if (text) {
      log.debug(`Claude usage: in=${resp.usage.input_tokens} out=${resp.usage.output_tokens} cache_read=${resp.usage.cache_read_input_tokens || 0}`);
    }
    return text || null;
  } catch (err) {
    log.warn(`Claude generation failed: ${err.message}`);
    return null;
  }
}

async function buildCoverLetter(template, vacancy, matchedSkills) {
  const claudeText = await buildWithClaude(vacancy, matchedSkills);
  if (claudeText) return claudeText;
  return buildFromTemplate(template, vacancy, matchedSkills);
}

const BATCH_LETTERS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    letters: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          vacancyId: { type: 'string' },
          coverLetter: { type: 'string' },
        },
        required: ['vacancyId', 'coverLetter'],
      },
    },
  },
  required: ['letters'],
};

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

function formatVacancyShort(vacancy, matchedSkills) {
  const description = stripHtml(vacancy.description).slice(0, 3000);
  const skills = (vacancy.key_skills || []).map(s => s.name).join(', ');
  return `id: ${vacancy.id}
Название: ${vacancy.name}
Компания: ${vacancy.employer?.name || '—'}
Регион: ${vacancy.area?.name || '—'}
Ключевые навыки: ${skills || '—'}
Совпавшие с резюме: ${matchedSkills?.join(', ') || '—'}

Описание:
${description}`;
}

// Генерирует сопроводительные пачками по batchSize вакансий за один запрос.
// items: [{ vacancy, matchedSkills }]. Возвращает Map<vacancyId, text>.
async function buildCoverLettersBatch(resume, items, batchSize = 20) {
  const client = getClient();
  const result = new Map();
  if (!client || !items.length) return result;

  const model = process.env.CLAUDE_MODEL || 'claude-opus-4-7';
  const profile = process.env.APPLICANT_PROFILE || 'опытный разработчик';
  const resumeBlock = buildResumeBlock(resume);

  const systemText = `Ты помогаешь соискателю писать сопроводительные письма для откликов на hh.ru. Профиль соискателя: ${profile}

Для каждой поданной вакансии напиши сопроводительное от первого лица, 5–7 предложений. Ориентируйся на этот образец по тону и ритму:

"""
Увидел вашу вакансию — стек прям полностью совпадает, решил написать. Я фуллстек, последние пару лет пишу на React + NestJS. С SQL и ORM (чаще TypeORM и Prisma) работаю каждый день, Next.js тоже трогал, пару проектов с SSR было. Задачи знакомые: архитектуру обсуждал, приложения с нуля заводил, легаси подшаманивал. Удалёнка по Мск идеально, я живу в этом же часовом поясе. Можем созвониться, расскажу подробнее.
"""

Правила:
- Живой разговорный тон, как будто человек быстро набрал в чат. Короткие фразы, тире, скобки — ок.
- Лёгкая неформальность: "трогал", "подшаманивал", "прям", "идеально" — такие словечки допустимы и желательны.
- Без канцелярита и шаблонов ("рассмотрите мою кандидатуру", "готов внести вклад", "имею опыт", "считаю себя", "мои сильные стороны").
- Не прилизывай идеально — пусть читается как живое сообщение, а не через нейронку.
- Первая фраза — крюк за конкретику вакансии ("увидел...", "наткнулся на...", "стек совпадает...").
- Упомяни 1–2 конкретных совпадения из описания/резюме.
- Без markdown, без подписи "С уважением".
- Можно с "Привет!" / "Здравствуйте!" или сразу к делу, как в образце.
- Заверши строкой "Telegram: @your_telegram".

Верни массив letters с полем vacancyId для каждой вакансии в том же порядке.`;

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const text = batch.map((it, idx) =>
      `=== ВАКАНСИЯ #${idx + 1} ===\n${formatVacancyShort(it.vacancy, it.matchedSkills)}`
    ).join('\n\n');

    try {
      const resp = await client.messages.create({
        model,
        max_tokens: Math.min(16000, 400 * batch.length + 500),
        system: [{ type: 'text', text: systemText, cache_control: { type: 'ephemeral' } }],
        messages: [{
          role: 'user',
          content: [
            ...(resumeBlock ? [resumeBlock] : []),
            { type: 'text', text },
          ],
        }],
        output_config: {
          format: { type: 'json_schema', schema: BATCH_LETTERS_SCHEMA },
        },
      });

      const block = resp.content.find(b => b.type === 'text');
      if (!block) {
        log.warn(`cover batch ${i / batchSize + 1}: empty response`);
        continue;
      }
      const parsed = JSON.parse(block.text);
      for (const l of parsed.letters || []) {
        if (l.vacancyId && l.coverLetter) result.set(String(l.vacancyId), l.coverLetter);
      }
      log.debug(`cover batch ${i / batchSize + 1}: ${batch.length} letters, cache_read=${resp.usage.cache_read_input_tokens || 0} in=${resp.usage.input_tokens || 0} out=${resp.usage.output_tokens || 0}`);
    } catch (err) {
      log.warn(`cover batch failed (${batch.length} items): ${err.message}`);
    }
  }

  return result;
}

module.exports = { buildCoverLetter, buildCoverLettersBatch };
