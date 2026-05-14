// Кэш в отдельных MongoDB коллекциях: cachePages, cacheFull, cacheJudgements, cacheCoverLetters.
import { connect, dbInstance } from "./db.js";

function dateKey(d?: Date): string {
  return (d || new Date()).toISOString().slice(0, 10);
}

export interface CacheDoc {
  date: string;
  pages: Record<string, any[]>;
  fullById: Record<string, any>;
  judgements: Record<string, any>;
  coverLetters: Record<string, string>;
}

export async function load(date?: Date): Promise<CacheDoc> {
  await connect();
  const db = dbInstance();
  const key = dateKey(date);

  const [pageDocs, fullDocs, judgeDocs, coverDocs] = await Promise.all([
    db.collection('cachePages').find({ date: key }).toArray(),
    db.collection('cacheFull').find({ date: key }).toArray(),
    db.collection('cacheJudgements').find({ date: key }).toArray(),
    db.collection('cacheCoverLetters').find({ date: key }).toArray(),
  ]);

  const pages: Record<string, any[]> = {};
  for (const d of pageDocs) pages[String(d.page)] = d.items;

  const fullById: Record<string, any> = {};
  for (const d of fullDocs) fullById[d.vacancyId] = d.full;

  const judgements: Record<string, any> = {};
  for (const d of judgeDocs) {
    const { vacancyId, _id, date: _, ...rest } = d;
    judgements[vacancyId] = rest;
  }

  const coverLetters: Record<string, string> = {};
  for (const d of coverDocs) coverLetters[d.vacancyId] = d.letter;

  return { date: key, pages, fullById, judgements, coverLetters };
}

export async function savePage(state: CacheDoc, pageNum: number, date?: Date): Promise<void> {
  await connect();
  await dbInstance().collection('cachePages').updateOne(
    { date: dateKey(date), page: pageNum },
    { $set: { items: state.pages?.[String(pageNum)] || [] } },
    { upsert: true },
  );
}

export async function saveFull(state: CacheDoc, vacancyId: string, date?: Date): Promise<void> {
  await connect();
  await dbInstance().collection('cacheFull').updateOne(
    { vacancyId: String(vacancyId) },
    { $set: { date: dateKey(date), vacancyId: String(vacancyId), full: state.fullById?.[String(vacancyId)] } },
    { upsert: true },
  );
}

export async function saveJudgements(state: CacheDoc, date?: Date): Promise<void> {
  await connect();
  const db = dbInstance();
  const key = dateKey(date);
  const coll = db.collection('cacheJudgements');
  await coll.deleteMany({ date: key });
  const docs = Object.entries(state.judgements || {}).map(([vid, j]) => ({
    date: key, vacancyId: vid, score: j.score, fit: j.fit,
    reason: j.reason, redFlags: j.redFlags || [],
  }));
  if (docs.length) await coll.insertMany(docs);
}

export async function saveCoverLetter(state: CacheDoc, vacancyId: string, date?: Date): Promise<void> {
  await connect();
  await dbInstance().collection('cacheCoverLetters').updateOne(
    { vacancyId: String(vacancyId) },
    { $set: { date: dateKey(date), vacancyId: String(vacancyId), letter: state.coverLetters?.[String(vacancyId)] || '' } },
    { upsert: true },
  );
}

export async function clear(): Promise<string[]> {
  await connect();
  const db = dbInstance();
  const collections = ['cachePages', 'cacheFull', 'cacheJudgements', 'cacheCoverLetters'];
  const removed: string[] = [];
  for (const coll of collections) {
    const r = await db.collection(coll).deleteMany({});
    if (r.deletedCount) removed.push(`${coll}: ${r.deletedCount}`);
  }
  return removed;
}

export function fileFor(date?: Date): string {
  return `cache:${dateKey(date)}`;
}
