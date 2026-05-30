1// CLI entry point: регистрирует команды и запускает Commander.
import {  Command  } from "commander";
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
  .option('-r, --resume <name>', 'Имя резюме из RESUMES_DIR')
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
  .option('-r, --resume <name>', 'Имя резюме из RESUMES_DIR')
  .action((vacancyId, opts) => cmdCover(vacancyId, opts));

program
  .command('schedule')
  .description('Запустить планировщик — выполняет search по расписанию из config.json')
  .action(cmdSchedule);

program
  .command('grade')
  .description('Оценить резюме через AI')
  .option('-r, --resume <name>', 'Имя резюме из RESUMES_DIR')
  .action(cmdGradeResume);

program
  .command('resume')
  .description('Управление резюме: list / register <name>')
  .argument('[subcommand]', 'list или register')
  .argument('[name]', 'Имя резюме для register')
  .action((subcommand, name) => cmdResume({ _: [subcommand, name].filter(Boolean) }));

export default program;
