// Генерация сопроводительного письма.
// Использует OpenAI-совместимый API (OpenAI, Deepseek и т.п.).
// Если API-ключ не задан — fallback на шаблон из config.json с плейсхолдерами:
//   {title}, {employer}, {matchedSkills}, {area}.
import OpenAI from "openai";
import log from "./logger.js";
import {  retryOnTransient  } from "./retry.js";
import {  loadConfig  } from "./config.js";
import {  stripHtml, parseJSON  } from "./claude.js";

const apiConfig = loadConfig().api || {};

function getClient() {
  const key = apiConfig.apiKey || process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const opts: Record<string, any> = { apiKey: key, maxRetries: 3 };
  if (apiConfig.baseUrl) opts.baseURL = apiConfig.baseUrl;
  return new OpenAI(opts);
}

function buildResumeBlock(resume) {
  if (!resume) return null;
  if (resume.type === 'pdf') {
    return { type: 'text', text: `=== РЕЗЮМЕ СОИСКАТЕЛЯ (PDF) ===\n${resume.filename}` };
  }
  return { type: 'text', text: `=== РЕЗЮМЕ СОИСКАТЕЛЯ ===\n${resume.text}` };
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

async function buildWithClaude(vacancy, matchedSkills) {
  const client = getClient();
  if (!client) return null;

  const profile = process.env.APPLICANT_PROFILE || 'опытный разработчик';
  const model = process.env.CLAUDE_MODEL || 'gpt-4o';

  const description = stripHtml(vacancy.description).slice(0, 1000);
  const skills = (vacancy.key_skills || []).map(s => s.name).join(', ');

  const userMsg = `Вакансия: ${vacancy.name}
Компания: ${vacancy.employer?.name || '—'}
Регион: ${vacancy.area?.name || '—'}
Ключевые навыки: ${skills || '—'}
Совпавшие с моими: ${matchedSkills?.join(', ') || '—'}

Описание:
${description}

Напиши короткое сопроводительное письмо от моего имени в официально-деловом стиле. ЖЁСТКОЕ ограничение: **300–400 символов включая пробелы и подпись с Telegram**. 2–4 предложения.

Образец:
"""
Здравствуйте! Заинтересовала ваша вакансия — профиль полностью совпадает с моим опытом. Последние несколько лет работаю с React и NestJS, уверенно владею SQL/ORM, есть опыт с Next.js и SSR. Буду рад обсудить детали на созвоне.
Telegram: @your_telegram
"""

Правила:
- Официально-деловой, нейтрально-вежливый тон. Полные предложения, грамотный русский.
- Никакой разговорности, сленга, сокращений ("прям", "трогал", "подшаманивал" и т.п.).
- Избегай канцеляритных штампов ("рассмотрите мою кандидатуру", "готов внести вклад в развитие"): пиши по делу, но корректно.
- Начни с "Здравствуйте!".
- 1–2 конкретных совпадения из описания вакансии.
- Без markdown, без "С уважением", без имени в подписи.
- Заверши строкой "Telegram: @your_telegram".
- Не упоминай зарплату, вилку, ожидания по доходу — ни конкретных цифр, ни общих формулировок ("по рынку", "обсуждаемо" и т.п.).
- Проверь длину: 300–400 символов.`;

  try {
    const resp = await retryOnTransient(() => client.chat.completions.create({
      model,
      max_tokens: 4000,
      messages: [
        {
          role: 'system',
          content: `Ты помогаешь соискателю писать сопроводительные письма для откликов на hh.ru. Профиль соискателя: ${profile}\n\nПиши лаконично, по-человечески, без канцелярита. Цель — убедить рекрутера открыть резюме.`,
        },
        { role: 'user', content: userMsg },
      ],
    })) as any;
    const text = resp.choices?.[0]?.message?.content?.trim();
    if (text) {
      log.debug(`Claude usage: in=${resp.usage?.prompt_tokens} out=${resp.usage?.completion_tokens}`);
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

function buildBatchSystemText(profile: string): string {
  return `Ты помогаешь соискателю писать сопроводительные письма для откликов на hh.ru. Профиль соискателя: ${profile}
Для каждой вакансии напиши короткое сопроводительное от первого лица в официально-деловом стиле. ЖЁСТКОЕ ограничение: **300–400 символов включая пробелы и подпись с Telegram**. 2–4 предложения.

Образец:
"""
Здравствуйте! Заинтересовала ваша вакансия — профиль полностью совпадает с моим опытом. Последние несколько лет работаю с React и NestJS, уверенно владею SQL/ORM, есть опыт с Next.js и SSR. Буду рад обсудить детали на созвоне.
Telegram: @your_telegram
"""

Правила:
- Официально-деловой, нейтрально-вежливый тон. Полные предложения, грамотный русский. Без разговорности и сленга.
- Избегай канцеляритных штампов ("рассмотрите мою кандидатуру", "готов внести вклад в развитие"): по делу, но корректно.
- Начни с "Здравствуйте!".
- 1–2 конкретных совпадения из описания вакансии.
- Без markdown, без "С уважением", без имени в подписи.
- Заверши строкой "Telegram: @your_telegram".
- Проверь длину: 300–400 символов.

Верни ТОЛЬКО JSON в формате:
{"letters": [{"vacancyId": "id", "coverLetter": "текст"}, ...]}
Никаких пояснений, никакого markdown, только JSON.`;
}

function formatVacancyShort(vacancy, matchedSkills) {
  const description = stripHtml(vacancy.description).slice(0, 1000);
  const skills = (vacancy.key_skills || []).map(s => s.name).join(', ');
  return `vacancyId: ${vacancy.id}
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
// onBatch(partialResult) — вызывается после каждой пачки с накопленным результатом.
async function buildCoverLettersBatch(resume, items, batchSize = 1, onBatch = null) {
  const client = getClient();
  const result = new Map();
  if (!client || !items.length) return result;

  const model = process.env.CLAUDE_MODEL || 'gpt-4o';
  const profile = process.env.APPLICANT_PROFILE || 'опытный разработчик';
  const resumeBlock = buildResumeBlock(resume);

  const systemText = buildBatchSystemText(profile);

  const batchTexts = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    batchTexts.push({
      idx: batchTexts.length + 1,
      batch,
      text: batch.map((it, idx) =>
        `=== ВАКАНСИЯ #${idx + 1} ===\n${formatVacancyShort(it.vacancy, it.matchedSkills)}`
      ).join('\n\n'),
    });
  }

  let nextBatchIdx = 0;
  const CONCURRENCY = 3;

  async function runBatch(ii) {
    const { idx, batch, text } = batchTexts[ii];
    const messages = [
      { role: 'system', content: systemText },
      {
        role: 'user',
        content: [
          ...(resumeBlock ? [resumeBlock] : []),
          { type: 'text' as const, text },
        ] as any,
      },
    ] as any;
    try {
      const resp = await retryOnTransient(() => client.chat.completions.create({
        model,
        max_tokens: 4000,
        messages,
      }));

      const r = resp as any;
      const content = r.choices?.[0]?.message?.content;
      if (!content) {
        log.warn(`cover batch ${idx}: empty response`);
        return;
      }
      const parsed = parseJSON(content);
      for (const l of parsed.letters || []) {
        if (l.vacancyId && l.coverLetter) result.set(String(l.vacancyId), l.coverLetter);
      }
      log.debug(`cover batch ${idx}: ${batch.length} letters, in=${r.usage?.prompt_tokens || 0} out=${r.usage?.completion_tokens || 0}`);
      if (onBatch) {
        try { await onBatch(result); } catch (e) { log.warn(`cover onBatch callback failed: ${e.message}`); }
      }
    } catch (err) {
      log.warn(`cover batch ${idx} failed (${batch.length} items): ${err.message}`);
    }
  }

  async function worker() {
    while (nextBatchIdx < batchTexts.length) {
      const ii = nextBatchIdx;
      nextBatchIdx++;
      await runBatch(ii);
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batchTexts.length) }, () => worker()));

  return result;
}

export { buildCoverLetter, buildCoverLettersBatch };
