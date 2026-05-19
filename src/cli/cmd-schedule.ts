// Команда schedule: запуск search по cron-расписанию.
import cron from "node-cron";
import {  loadConfig  } from "../config";
import log from "../logger";
import search from "./cmd-search.js";

function getNextDate(expression: string): Date | null {
  // minute hour day-of-month month day-of-week
  const parts = expression.trim().split(/\s+/);
  if (parts.length < 5) return null;

  // Простой перебор на 48 часов вперёд для поиска следующего совпадения
  const now = new Date();
  for (let i = 1; i <= 60 * 48; i++) {
    const d = new Date(now.getTime() + i * 60000);
    const min = d.getMinutes();
    const hour = d.getHours();
    const dom = d.getDate();
    const mon = d.getMonth() + 1;
    const dow = d.getDay();

    const match = (p: string, v: number) => {
      if (p === "*") return true;
      if (p.includes("*/")) {
        const step = parseInt(p.split("/")[1], 10);
        return step > 0 && v % step === 0;
      }
      if (p.includes("-")) {
        const [a, b] = p.split("-").map(Number);
        return v >= a && v <= b;
      }
      if (p.includes(",")) return p.split(",").map(Number).includes(v);
      return parseInt(p, 10) === v;
    };

    if (match(parts[0], min) && match(parts[1], hour) &&
        match(parts[2], dom) && match(parts[3], mon) &&
        match(parts[4], dow)) {
      return d;
    }
  }
  return null;
}

export default async function cmdSchedule() {
  const cfg = loadConfig();

  if (!cfg.schedule?.cron) {
    console.error("schedule.cron не задан в config.json");
    process.exit(1);
  }

  const expression = cfg.schedule.cron;

  if (!cron.validate(expression)) {
    console.error(`Невалидное cron-выражение: ${expression}`);
    process.exit(1);
  }

  const next = getNextDate(expression);
  const nextStr = next ? next.toLocaleString("ru-RU") : "неизвестно";
  console.log(`Планировщик запущен. Расписание: ${expression}`);
  console.log(`Следующий запуск: ${nextStr}`);
  console.log("Для остановки нажмите Ctrl+C\n");

  cron.schedule(expression, async () => {
    const now = new Date().toISOString();
    console.log(`\n=== Запуск search по расписанию (${now}) ===`);
    log.info("Scheduled search started");

    try {
      await search({ claude: true });
      log.info("Scheduled search completed successfully");
      console.log(`✅ Search завершён (${new Date().toISOString()})`);
    } catch (err: any) {
      log.error(`Scheduled search failed: ${err.message}`);
      console.error(`❌ Ошибка search:`, err.message);
    }

    const next2 = getNextDate(expression);
    if (next2) {
      console.log(`⏰ Следующий запуск: ${next2.toLocaleString("ru-RU")}\n`);
    }
  });
}
