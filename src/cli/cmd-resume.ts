// Команда resume: управление резюме.
import { listResumes, loadResume } from "../resume.js";
import { registerResume, listResumes as listMongo } from "../resume-store.js";
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

export default async function cmdResume(opts: Record<string, any> = {}, command?: string) {
  const sub = opts._?.join(' ') || 'list';
  if (sub.startsWith('register')) {
    const [, name] = sub.split(/\s+/);
    await cmdResumeRegister(name);
  } else {
    await cmdResumeList();
  }
}
