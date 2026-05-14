import fs from "fs";
import path from "path";
import { connect, dbInstance } from "./db";

const DATA_DIR = path.join(__dirname, '..', 'data');

function dateKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function toMarkdown(entries: any[], title: string): string {
  const lines: string[] = [`# ${title} — ${dateKey()} (${entries.length} вакансий)\n`];
  for (const e of entries) {
    lines.push(`---`);
    lines.push(`**${e.title || '—'}** @ ${e.employer || '—'}`);
    lines.push(`- Регион: ${e.area || '—'}`);
    lines.push(`- Зарплата: ${e.salary || '—'}`);
    if (e.score != null) lines.push(`- Оценка: ${e.score}/10`);
    if (e.reason) lines.push(`- Причина: ${e.reason}`);
    if (e.redFlags?.length) lines.push(`- Флаги: ${e.redFlags.join(', ')}`);
    if (e.url) lines.push(`- Ссылка: ${e.url}`);
    if (e.coverLetter) {
      lines.push(`\n**Сопроводительное:**\n\n${e.coverLetter}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

async function writeToMongo(collection: string, entries: any[]): Promise<void> {
  if (!entries.length) return;
  await connect();
  const key = dateKey();
  await dbInstance().collection(collection).updateOne(
    { date: key },
    { $set: { date: key, entries } },
    { upsert: true },
  );
}

export async function writeDigest(entries: any[]): Promise<string | null> {
  if (!entries.length) return null;
  ensureDir();
  const key = dateKey();
  const md = path.join(DATA_DIR, `digest-${key}.md`);
  fs.writeFileSync(md, toMarkdown(entries, 'Дайджест вакансий'));
  await writeToMongo('digest', entries);
  return md;
}

export async function writeRejected(entries: any[]): Promise<string | null> {
  if (!entries.length) return null;
  ensureDir();
  const key = dateKey();
  const md = path.join(DATA_DIR, `rejected-${key}.md`);
  fs.writeFileSync(md, toMarkdown(entries, 'Отклонённые вакансии'));
  await writeToMongo('rejected', entries);
  return md;
}
