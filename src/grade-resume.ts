import { loadConfig } from "./config.js";
import { getClient } from "./ai-client.js";
import { loadResume } from "./resume.js";
import { retryOnTransient } from "./retry.js";
import log from "./logger.js";

const apiConfig = loadConfig().api || {};

function safeJsonParse(text: string): any {
  let cleaned = text.trim();
  cleaned = cleaned.replace(/^```json\s*\n?/i, "").replace(/\n?```\s*$/i, "");
  cleaned = cleaned.replace(/^\*\*+/, "").replace(/\*\*+$/, "");
  // Попытка распарсить как есть
  try {
    return JSON.parse(cleaned);
  } catch {
    // Если не вышло — экранируем неэкранированные кавычки внутри строк
    // (грубая эвристика: заменяем " внутри значений на «»)
    cleaned = cleaned.replace(
      /: "([^"]*?)"([^,\]\}])/g,
      (_m, p1, p2) => `: "${p1.replace(/"/g, "«")}"${p2}`
    );
    try {
      return JSON.parse(cleaned);
    } catch {
      // Последняя попытка: удалить управляющие символы
      cleaned = cleaned.replace(/[\x00-\x1f]/g, " ");
      return JSON.parse(cleaned);
    }
  }
}

function buildSystemText(): string {
  return `Ты профессиональный HR-эксперт и карьерный консультант. Проведи подробную оценку резюме соискателя.

Сначала напиши общую оценку — 1-2 абзаца (на русском), резюмирующие впечатление, уровень кандидата, ключевые выводы.

Затем сформируй списки:
- **strengths** — сильные стороны (3-5 пунктов)
- **weaknesses** — слабые стороны (3-4 пункта)
- **missing** — что отсутствует в резюме (2-3 пункта)
- **recommendations** — конкретные рекомендации (3-4 пункта)

Оцени 5 взвешенных категорий (сумма max = 100):
1. **Первое впечатление** — заголовок, контактные данные, первые строки (max 25)
2. **Ясность позиционирования** — насколько понятна роль и уровень (max 25)
3. **Красные флаги** — перерывы, частая смена работы, несоответствия (max 20)
4. **Контекст и масштаб** — размеры команд, масштабы проектов, бизнес-импакт (max 20)
5. **Готовность к шортлисту** — общее впечатление, готовность рекомендовать (max 10)

Затем сделай детальный разбор по 9 категориям. Для каждой:
- **status**: "good" или "attention"
- **description**: 1-2 предложения с анализом
- **quotes**: цитаты из резюме (1-3 строки). ВАЖНО: экранируй кавычки внутри цитат (заменяй " на \\")
- **recommendations** (опционально): советы по улучшению

Категории детального разбора:
1. Грамотность — орфография, пунктуация, читаемость
2. Красные флаги — перерывы, частая смена работы, несоответствия
3. Позиционирование — соответствие целевой роли
4. Первые 10 секунд — заголовок, компании, технологии
5. Социальные доказательства — известные компании, проекты
6. Навыки — релевантность, полнота, современность стека
7. Секция "Обо мне" — самопрезентация, конкретика
8. Карьерный путь — логичность роста, последовательность
9. Качество описания опыта — метрики, достижения вместо обязанностей

ВАЖНО: все строки в JSON должны быть валидными. Экранируй кавычки внутри строк через \\". Не используй неэкранированные кавычки внутри значений.

Формат ответа — строго JSON:
{
  "overallScore": 82,
  "overallAssessment": "текст",
  "strengths": ["сильная сторона"],
  "weaknesses": ["слабая сторона"],
  "missing": ["чего не хватает"],
  "recommendations": ["рекомендация"],
  "categoryScores": {
    "firstImpression": { "score": 20, "max": 25 },
    "positioning": { "score": 22, "max": 25 },
    "redFlags": { "score": 20, "max": 20 },
    "contextAndScale": { "score": 15, "max": 20 },
    "shortlistReadiness": { "score": 5, "max": 10 }
  },
  "detailedAnalysis": [
    {
      "category": "Грамотность",
      "status": "good",
      "description": "текст",
      "quotes": ["цитата из резюме"],
      "recommendations": ["совет"]
    }
  ]
}`;
}

async function gradeResume(resume?: any, resumeName?: string): Promise<Record<string, any> | null> {
  const client = getClient(apiConfig);
  if (!client) {
    log.warn("gradeResume: no API client (check API key)");
    return null;
  }

  const model = process.env.CLAUDE_MODEL || "gpt-4o";

  const r = resume || loadResume(resumeName);
  if (!r) {
    log.warn("gradeResume: resume not found (set RESUME_PATH)");
    return null;
  }

  const resumeText = r.type === "pdf" ? `[PDF] ${r.filename}` : r.text;

  const messages = [
    { role: "system" as const, content: buildSystemText() },
    {
      role: "user" as const,
      content: `Оцени следующее резюме:\n\n${resumeText}`,
    },
  ];

  try {
    const resp = await retryOnTransient(() =>
      client.chat.completions.create({
        model,
        max_tokens: 50000,
        messages,
        response_format: { type: "json_object" },
      })
    );

    const text = (resp as any).choices?.[0]?.message?.content;
    if (!text) {
      log.warn("gradeResume: empty response");
      return null;
    }

    const parsed = safeJsonParse(text);
    log.debug(
      `gradeResume: score=${parsed.overallScore} in=${(resp as any).usage?.prompt_tokens} out=${(resp as any).usage?.completion_tokens}`
    );
    return parsed;
  } catch (err: any) {
    log.warn(`gradeResume failed: ${err.message}`);
    return null;
  }
}

export { gradeResume };