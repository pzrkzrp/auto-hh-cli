// Команда ui: интерактивное меню поверх остальных команд.
// Меню ничего не делает само — оно только собирает ответы и вызывает существующие cmd-*.
import { confirm, input, select, Separator } from "@inquirer/prompts";
import cmdSearch from "./cmd-search.js";
import cmdApply from "./cmd-apply.js";
import cmdDigest from "./cmd-digest.js";
import cmdHistory from "./cmd-history.js";
import cmdConfig from "./cmd-config.js";
import cmdReset from "./cmd-reset.js";
import cmdCover from "./cmd-cover.js";
import cmdSchedule from "./cmd-schedule.js";
import cmdGradeResume from "./cmd-grade-resume.js";
import cmdResume from "./cmd-resume.js";
import { listResumes } from "../resume.js";

// Значение «резюме не указано»: команда сама возьмёт RESUME_PATH или первый файл из RESUMES_DIR.
const DEFAULT_RESUME = "__default__";

type MenuItem =
  | "search"
  | "apply"
  | "login"
  | "digest"
  | "history"
  | "resume"
  | "grade"
  | "cover"
  | "schedule"
  | "config"
  | "reset"
  | "exit";

/** Промпты @inquirer бросают ExitPromptError на Ctrl+C / Esc — это не ошибка приложения. */
export function isPromptCancelled(err: any): boolean {
  return err?.name === "ExitPromptError";
}

/**
 * Меню требует TTY: без него не работает ни raw-режим stdin, ни стрелки.
 * В CI/пайпе команда просто печатает подсказку и завершается с кодом 0.
 */
export function isInteractive(): boolean {
  return Boolean(process.stdout.isTTY && process.stdin.isTTY);
}

/** Собирает opts для `search` из ответов меню (совпадают с флагами CLI). */
export function buildSearchOptions(answers: {
  resume?: string;
  useAi: boolean;
  dryRun: boolean;
  reset: boolean;
}): Record<string, any> {
  return {
    resume: answers.resume,
    claude: answers.useAi,
    dryRun: answers.dryRun,
    reset: answers.reset,
  };
}

/** Собирает opts для `apply` из ответов меню: limit=0 означает «без лимита». */
export function buildApplyOptions(answers: { type: string; limit: number }): Record<string, any> {
  const opts: Record<string, any> = { type: answers.type };
  if (Number.isFinite(answers.limit) && answers.limit > 0) opts.limit = answers.limit;
  return opts;
}

/** Выбор резюме списком; undefined = «как настроено в .env». */
async function pickResume(message: string, allowDefault = true): Promise<string | undefined> {
  const files = listResumes();
  const choices: { name: string; value: string }[] = [];

  if (allowDefault) {
    choices.push({ name: "по умолчанию (RESUME_PATH / первый из RESUMES_DIR)", value: DEFAULT_RESUME });
  }
  for (const f of files) {
    choices.push({ name: `${f.name}  (${f.filename})`, value: f.name });
  }

  // RESUMES_DIR пуст — выбор невозможен, отдаём решение самой команде.
  if (!choices.length) return undefined;

  const value = await select({ message, choices, default: choices[0].value });
  return value === DEFAULT_RESUME ? undefined : value;
}

/** Имя резюме: списком, если RESUMES_DIR заполнен, иначе — ручным вводом. */
async function askResumeName(message: string): Promise<string> {
  const files = listResumes();
  if (files.length) {
    return select({
      message,
      choices: files.map(f => ({ name: `${f.name}  (${f.filename})`, value: f.name })),
    });
  }
  const name = await input({
    message: `${message} (RESUMES_DIR пуст — введите имя без расширения):`,
    validate: (v: string) => (v.trim() ? true : "Введите имя резюме"),
  });
  return name.trim();
}

async function runSearch() {
  const resume = await pickResume("Какое резюме использовать?");
  const useAi = await confirm({ message: "Использовать ИИ-судью и генерацию сопроводительных?", default: true });
  const dryRun = await confirm({ message: "Dry-run: только поиск и отбор, без генерации писем?", default: false });
  const reset = await confirm({
    message: "Сбросить историю, кэш и дайджесты перед запуском? (необратимо)",
    default: false,
  });

  console.log();
  await cmdSearch(buildSearchOptions({ resume, useAi, dryRun, reset }));
}

async function runApply() {
  const type = await select({
    message: "Откуда брать вакансии для отклика?",
    choices: [
      { name: "latest — только сегодняшний дайджест (по умолчанию)", value: "latest" },
      { name: "all — все сохранённые дайджесты", value: "all" },
    ],
    default: "latest",
  });

  const limitRaw = await input({
    message: "Сколько вакансий обработать (0 — без лимита):",
    default: "0",
    validate: (v: string) => (/^\d+$/.test(v.trim()) ? true : "Введите целое число ≥ 0"),
  });

  console.log();
  await cmdApply(buildApplyOptions({ type, limit: parseInt(limitRaw.trim(), 10) }));
}

async function runResumeMenu() {
  const action = await select({
    message: "Резюме:",
    choices: [
      { name: "list — показать доступные резюме", value: "list" },
      { name: "show — показать резюме", value: "show" },
      { name: "register — зарегистрировать в MongoDB", value: "register" },
      new Separator(),
      { name: "← назад", value: "back" },
    ],
  });

  if (action === "back") return;
  if (action === "list") {
    console.log();
    await cmdResume({ _: ["list"] });
    return;
  }

  const name = await askResumeName(action === "register" ? "Какое резюме зарегистрировать?" : "Какое резюме показать?");
  console.log();
  await cmdResume({ _: [action, name] });
}

async function runGrade() {
  const resume = await pickResume("Какое резюме оценить?");
  console.log();
  await cmdGradeResume({ resume });
}

async function runCover() {
  const vacancyId = await input({
    message: "ID вакансии (из ссылки hh.ru/vacancy/<id>):",
    validate: (v: string) => (v.trim() ? true : "Введите id вакансии"),
  });
  const resume = await pickResume("Какое резюме использовать для письма?");
  console.log();
  await cmdCover(vacancyId.trim(), { resume });
}

async function runSchedule() {
  const run = await confirm({
    message: "Запустить планировщик? Он блокирующий: выход — Ctrl+C.",
    default: true,
  });
  if (!run) return;
  console.log();
  await cmdSchedule();
}

async function runReset() {
  const run = await confirm({
    message: "Удалить историю, кэш и дайджесты (файлы + MongoDB)? Действие необратимо.",
    default: false,
  });
  if (!run) {
    console.log("Сброс отменён.");
    return;
  }
  console.log();
  await cmdReset();
}

async function mainMenu(): Promise<MenuItem> {
  return select<MenuItem>({
    message: "auto-hh — что сделать?",
    pageSize: 15,
    choices: [
      { name: "🔍 Поиск вакансий (search)", value: "search" },
      { name: "🚀 Отклики из дайджеста (apply)", value: "apply" },
      { name: "🔑 Войти на hh.ru (apply --login)", value: "login" },
      new Separator(),
      { name: "📄 Последний дайджест (digest)", value: "digest" },
      { name: "🕓 История откликов (history)", value: "history" },
      { name: "🧾 Резюме (resume list/show/register)", value: "resume" },
      { name: "🎯 Оценить резюме ИИ (grade)", value: "grade" },
      { name: "✉️  Сопроводительное по id (cover)", value: "cover" },
      new Separator(),
      { name: "⏰ Планировщик (schedule)", value: "schedule" },
      { name: "⚙️  Конфигурация (config)", value: "config" },
      { name: "🧹 Сброс данных (reset)", value: "reset" },
      new Separator(),
      { name: "⏹  Выход", value: "exit" },
    ],
  });
}

async function dispatch(item: MenuItem) {
  switch (item) {
    case "search": return runSearch();
    case "apply": return runApply();
    case "login": return cmdApply({ login: true });
    case "digest": {
      const json = await confirm({ message: "Вывести в JSON?", default: false });
      console.log();
      return cmdDigest({ json });
    }
    case "history": {
      const json = await confirm({ message: "Вывести в JSON?", default: false });
      console.log();
      return cmdHistory({ json });
    }
    case "resume": return runResumeMenu();
    case "grade": return runGrade();
    case "cover": return runCover();
    case "schedule": return runSchedule();
    case "config": return cmdConfig();
    case "reset": return runReset();
    default: return undefined;
  }
}

export default async function cmdUi() {
  if (!isInteractive()) {
    console.log("Интерактивное меню требует терминал (TTY) — stdin или stdout перенаправлены.");
    console.log("Запустите его в обычной консоли либо используйте команды напрямую: auto-hh --help");
    return;
  }

  console.log("\n=== auto-hh — интерактивное меню ===");
  console.log("Ctrl+C — выход\n");

  try {
    for (;;) {
      const item = await mainMenu();
      if (item === "exit") break;

      try {
        await dispatch(item);
      } catch (err: any) {
        // Ctrl+C внутри подменю — выходим из меню, остальное показываем и продолжаем.
        if (isPromptCancelled(err)) throw err;
        console.error(`\nОшибка: ${err?.message || err}\n`);
      }
    }
  } catch (err: any) {
    if (!isPromptCancelled(err)) {
      console.error(`Ошибка: ${err?.message || err}`);
      process.exitCode = 1;
    }
    return;
  } finally {
    // Промпт мог оставить stdin в raw-режиме — возвращаем терминал в нормальное состояние.
    try {
      if (process.stdin.isTTY && typeof process.stdin.setRawMode === "function") {
        process.stdin.setRawMode(false);
      }
    } catch { /* stdin уже закрыт — ничего страшного */ }
  }

  console.log("Пока!");
}
