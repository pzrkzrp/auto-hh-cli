// Загрузка резюме из директории RESUMES_DIR или одного файла RESUME_PATH.
// Поддерживает .txt / .md / .pdf.
import fs from "fs";
import path from "path";
import crypto from "crypto";
import type { Resume } from "./types.js";

const DIR = process.env.RESUMES_DIR ? path.resolve(process.env.RESUMES_DIR) : null;
const FILE = process.env.RESUME_PATH ? path.resolve(process.env.RESUME_PATH) : null;

// UUID v5 (SHA-1 based) из имени файла — детерминированный, не меняется между запусками.
function nameToUUID(filename: string): string {
  const NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'; // DNS namespace
  const hash = crypto.createHash('sha1').update(NAMESPACE + filename).digest();
  hash[6] = (hash[6] & 0x0f) | 0x50; // version 5
  hash[8] = (hash[8] & 0x3f) | 0x80; // variant 10xx
  const hex = hash.toString('hex');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20,32)}`;
}

function parseFile(abs: string, name: string): Resume {
  const ext = path.extname(abs).toLowerCase();
  const id = nameToUUID(path.basename(abs));
  if (ext === '.pdf') {
    return { name, id, type: 'pdf', data: fs.readFileSync(abs).toString('base64'), filename: path.basename(abs) };
  }
  return { name, id, type: 'text', text: fs.readFileSync(abs, 'utf-8'), filename: path.basename(abs) };
}

/** Сканирует RESUMES_DIR и возвращает список доступных резюме. */
export function listResumes(): { name: string; filename: string }[] {
  if (!DIR) return [];
  if (!fs.existsSync(DIR)) return [];
  return fs.readdirSync(DIR)
    .filter(f => /\.(md|txt|pdf)$/i.test(f))
    .map(f => ({ name: path.basename(f, path.extname(f)), filename: f }));
}

/** Загружает резюме по имени (без расширения) или по RESUME_PATH/RESUMES_DIR. */
export function loadResume(name?: string): Resume | null {
  if (name) {
    if (DIR) {
      for (const ext of ['.md', '.txt', '.pdf']) {
        const abs = path.join(DIR, `${name}${ext}`);
        if (fs.existsSync(abs)) return parseFile(abs, name);
      }
      throw new Error(`Resume "${name}" not found in ${DIR}`);
    }
    if (FILE && path.basename(FILE, path.extname(FILE)) === name) {
      return parseFile(FILE, name);
    }
    throw new Error(`RESUMES_DIR not set — cannot load resume by name. Set RESUMES_DIR or use RESUME_PATH.`);
  }

  if (FILE) {
    if (!fs.existsSync(FILE)) return null;
    return parseFile(FILE, path.basename(FILE, path.extname(FILE)));
  }

  if (DIR && fs.existsSync(DIR)) {
    const files = listResumes();
    if (files.length) return loadResume(files[0].name);
  }

  return null;
}
