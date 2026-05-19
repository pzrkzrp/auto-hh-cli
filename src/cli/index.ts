// CLI entry point: регистрирует команды и запускает Commander.
import {  Command  } from "commander";
import cmdSearch from "./cmd-search.js";
import cmdApply from "./cmd-apply.js";
import cmdDigest from "./cmd-digest.js";
import cmdHistory from "./cmd-history.js";
import cmdConfig from "./cmd-config.js";
import cmdReset from "./cmd-reset.js";
import cmdCover from "./cmd-cover.js";
import cmdSchedule from "./cmd-schedule.js";

const program = new Command();

program
  .name('auto-hh')
  .description('CLI для поиска, фильтрации и отклика на вакансии hh.ru')
  .version(require('../../package.json').version);

program
  .command('search')
  .description('Поиск вакансий, фильтр + Claude → дайджест')
  .option('-c, --config <path>', 'Путь к config.json')
  .option('-d, --dry-run', 'Только поиск, без генерации писем')
  .option('--no-claude', 'Без Claude, только локальный фильтр')
  .option('--reset', 'Сбросить историю и кэш перед запуском')
  .action(cmdSearch);

program
  .command('apply')
  .description('Откликнуться через Playwright на вакансии из дайджеста')
  .option('-l, --limit <n>', 'Сколько вакансий обработать', parseInt)
  .option('--login', 'Режим логина (открыть браузер для входа на hh.ru)')
  .action(cmdApply);

program
  .command('digest')
  .description('Показать последний дайджест')
  .option('-j, --json', 'Вывод в JSON')
  .action(cmdDigest);

program
  .command('history')
  .description('Показать историю откликов')
  .option('-j, --json', 'Вывод в JSON')
  .action(cmdHistory);

program
  .command('config')
  .description('Показать текущую конфигурацию')
  .action(cmdConfig);

program
  .command('reset')
  .description('Сбросить историю, кэш и дайджесты')
  .action(cmdReset);

program
  .command('cover <vacancyId>')
  .description('Сгенерировать сопроводительное для вакансии по id')
  .action(cmdCover);

program
  .command('schedule')
  .description('Запустить планировщик — выполняет search по расписанию из config.json')
  .action(cmdSchedule);

export default program;
