// Команда resume: управление резюме.
import { listResumes, loadResume } from "../resume.js";
import { registerResume, listResumes as listMongo } from "../store/resume-store";
import type { Resume } from "../types.js";
import log from "../logger.js";

async function cmdResumeList() {
  const files = listResumes();
  if (!files.length) {
    console.log("No resumes found. Set RESUMES_DIR or RESUME_PATH.");
    return;
  }

  const mongo = await listMongo();
  const byId = new Map(mongo.map(r => [r.resumeId, r]));

  console.log("\n=== Доступные резюме ===\n");
  for (const f of files) {
    const resume = loadResume(f.name);
    const registered = resume ? byId.get(resume.id) : null;
    console.log(`  ${f.name} (${resume?.id || '?'})${registered ? '' : ' (не зарегистрировано)'}`);
    console.log(`    Файл: ${f.filename}`);
    if (registered) console.log(`    Добавлено: ${registered.createdAt.toISOString().slice(0, 10)}`);
    console.log();
  }
}

async function cmdResumeRegister(name: string) {
  if (!name) {
    console.error('Usage: auto-hh resume register <name>');
    process.exit(1);
  }
  const resume = loadResume(name);
  if (!resume) {
    console.error(`Resume "${name}" not found`);
    process.exit(1);
  }
  await registerResume(resume);
  log.info(`Resume "${name}" registered (id: ${resume.id})`);
}

async function cmdResumeShow(name?: string) {
  let resume: Resume | null;
  try {
    resume = name ? loadResume(name) : loadResume();
  } catch (err: any) {
    console.error(err.message);
    process.exit(1);
  }
  if (!resume) {
    console.error('Резюме не найдено. Задайте RESUME_PATH или RESUMES_DIR в .env, либо укажите имя: auto-hh resume show <name>');
    process.exit(1);
  }

  console.log(`\n=== Резюме: ${resume.name} ===`);
  console.log(`  id:      ${resume.id}`);
  console.log(`  файл:    ${resume.filename}`);
  console.log(`  тип:     ${resume.type}`);
  console.log('');

  if (resume.type === 'pdf') {
    const bytes = resume.data ? Buffer.from(resume.data, 'base64').length : 0;
    console.log(`  PDF-документ (${bytes} байт) — текстовый вывод недоступен. Пересохраните в .md/.txt.`);
    return;
  }
  console.log('--- содержимое ---');
  console.log(resume.text);
}

export default async function cmdResume(opts: Record<string, any> = {}) {
  const sub = opts._?.join(' ') || 'list';
  if (sub.startsWith('register')) {
    const [, name] = sub.split(/\s+/);
    await cmdResumeRegister(name);
  } else if (sub.startsWith('show')) {
    const [, name] = sub.split(/\s+/);
    await cmdResumeShow(name);
  } else {
    await cmdResumeList();
  }
}
