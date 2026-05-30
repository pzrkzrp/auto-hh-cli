import { writeFileSync } from "fs";
import { join } from "path";
import log from "../logger.js";
import { gradeResume } from "../grade-resume.js";

function bar(score: number, max: number): string {
  const pct = Math.round((score / max) * 100);
  const filled = "█".repeat(Math.round(pct / 10));
  const empty = "░".repeat(10 - Math.round(pct / 10));
  return `${filled}${empty} ${score}/${max}`;
}

function buildMarkdown(result: Record<string, any>): string {
  const cs = result.categoryScores || {};
  const da = result.detailedAnalysis || [];
  const lines: string[] = [];

  lines.push("# Проверка резюме");
  lines.push("Оценка рекрутера\n");
  lines.push(`## Общая оценка: ${result.overallScore}/100\n`);
  if (result.overallAssessment) {
    lines.push(result.overallAssessment + "\n");
  }

  if (result.strengths?.length) {
    lines.push("### Сильные стороны");
    result.strengths.forEach((s: string) => lines.push(`- ${s}`));
    lines.push("");
  }
  if (result.weaknesses?.length) {
    lines.push("### Слабые стороны");
    result.weaknesses.forEach((s: string) => lines.push(`- ${s}`));
    lines.push("");
  }
  if (result.missing?.length) {
    lines.push("### Отсутствует");
    result.missing.forEach((s: string) => lines.push(`- ${s}`));
    lines.push("");
  }
  if (result.recommendations?.length) {
    lines.push("### Рекомендации");
    result.recommendations.forEach((s: string) => lines.push(`- ${s}`));
    lines.push("");
  }

  lines.push("## Оценки по категориям\n");
  lines.push(`| Категория | Оценка |`);
  lines.push(`|-----------|--------|`);
  const cats = [
    ["Первое впечатление", cs.firstImpression?.score ?? 0, cs.firstImpression?.max ?? 25],
    ["Ясность позиционирования", cs.positioning?.score ?? 0, cs.positioning?.max ?? 25],
    ["Красные флаги", cs.redFlags?.score ?? 0, cs.redFlags?.max ?? 20],
    ["Контекст и масштаб", cs.contextAndScale?.score ?? 0, cs.contextAndScale?.max ?? 20],
    ["Готовность к шортлисту", cs.shortlistReadiness?.score ?? 0, cs.shortlistReadiness?.max ?? 10],
  ];
  for (const [name, score, max] of cats) {
    lines.push(`| ${name} | ${bar(score as number, max as number)} |`);
  }
  lines.push("");

  if (da.length) {
    lines.push("## Детальный разбор\n");
    for (const item of da) {
      const badge = item.status === "good" ? "✅ Хорошо" : "⚠️ Требует внимания";
      lines.push(`### ${item.category} — ${badge}\n`);
      if (item.description) {
        lines.push(item.description + "\n");
      }
      if (item.quotes?.length) {
        for (const q of item.quotes) {
          lines.push(`> ${q}\n`);
        }
      }
      if (item.recommendations?.length) {
        lines.push("**Рекомендации:**\n");
        for (const r of item.recommendations) {
          lines.push(`- ${r}\n`);
        }
      }
    }
  }

  return lines.join("\n");
}

function formatGrade(result: Record<string, any>): void {
  if (!result) {
    console.log("Оценка не получена (проверьте API-ключ и RESUME_PATH)");
    return;
  }

  const cs = result.categoryScores || {};
  const da = result.detailedAnalysis || [];

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`  ПРОВЕРКА РЕЗЮМЕ`);
  console.log(`  Оценка рекрутера`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`\n  ${result.overallScore}/100\n`);

  if (result.overallAssessment) {
    console.log(`  ${result.overallAssessment}\n`);
  }

  if (result.strengths?.length) {
    console.log("  Сильные стороны:");
    result.strengths.forEach((s: string) => console.log(`    • ${s}`));
    console.log();
  }
  if (result.weaknesses?.length) {
    console.log("  Слабые стороны:");
    result.weaknesses.forEach((s: string) => console.log(`    • ${s}`));
    console.log();
  }
  if (result.missing?.length) {
    console.log("  Отсутствует:");
    result.missing.forEach((s: string) => console.log(`    • ${s}`));
    console.log();
  }
  if (result.recommendations?.length) {
    console.log("  Рекомендации:");
    result.recommendations.forEach((s: string) => console.log(`    • ${s}`));
    console.log();
  }

  console.log("  Оценки по категориям:");
  console.log(`    ${bar(cs.firstImpression?.score ?? 0, cs.firstImpression?.max ?? 25)}  — Первое впечатление`);
  console.log(`    ${bar(cs.positioning?.score ?? 0, cs.positioning?.max ?? 25)}      — Ясность позиционирования`);
  console.log(`    ${bar(cs.redFlags?.score ?? 0, cs.redFlags?.max ?? 20)}      — Красные флаги`);
  console.log(`    ${bar(cs.contextAndScale?.score ?? 0, cs.contextAndScale?.max ?? 20)}  — Контекст и масштаб`);
  console.log(`    ${bar(cs.shortlistReadiness?.score ?? 0, cs.shortlistReadiness?.max ?? 10)}       — Готовность к шортлисту`);

  if (da.length) {
    console.log(`\n  Детальный разбор:`);
    for (const item of da) {
      const badge = item.status === "good" ? "  Хорошо" : "  Требует внимания";
      console.log(`\n    ${item.category}${badge}`);
      if (item.description) {
        console.log(`    ${item.description}`);
      }
      if (item.quotes?.length) {
        for (const q of item.quotes) {
          console.log(`      "${q}"`);
        }
      }
      if (item.recommendations?.length) {
        console.log(`    Рекомендации:`);
        for (const r of item.recommendations) {
          console.log(`      → ${r}`);
        }
      }
    }
  }

  console.log();
}

async function cmdGradeResume(opts: Record<string, any> = {}) {
  const result = await gradeResume(undefined, opts.resume);
  formatGrade(result);

  if (result) {
    const md = buildMarkdown(result);
    const filePath = join(process.cwd(), "resume-grade.md");
    writeFileSync(filePath, md, "utf-8");
    console.log(`\n  Результат сохранён: resume-grade.md\n`);
  }
}

export { cmdGradeResume as default };
export { formatGrade };
