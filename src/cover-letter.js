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

Напиши короткое (4–6 предложений) сопроводительное письмо от моего имени. Без воды и общих фраз. Упомяни 1–2 конкретных пункта из описания вакансии, которые совпадают с моим опытом. Не используй markdown, не вставляй подпись и приветствие из шаблона — начни с "Здравствуйте!" и закончи "С уважением.".`;

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

module.exports = { buildCoverLetter };
