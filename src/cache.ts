// Кэш собранных вакансий в MongoDB.
// Одна запись на дату: { date, pages, fullById, judgements, coverLetters }
import { connect, dbInstance } from "./db.js";
import { Collection } from "mongodb";

const COLLECTION = 'cache';

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

function empty(): CacheDoc {
  return { date: '', pages: {}, fullById: {}, judgements: {}, coverLetters: {} };
}

async function col(): Promise<Collection<CacheDoc>> {
  await connect();
  return dbInstance().collection<CacheDoc>(COLLECTION);
}

export async function load(date?: Date): Promise<CacheDoc> {
  const c = await col();
  const key = dateKey(date);
  const doc = await c.findOne({ date: key });
  if (!doc) return { date: key, ...empty() };
  return {
    date: doc.date,
    pages: doc.pages || {},
    fullById: doc.fullById || {},
    judgements: doc.judgements || {},
    coverLetters: doc.coverLetters || {},
  };
}

export async function save(state: CacheDoc, date?: Date): Promise<void> {
  const c = await col();
  const key = dateKey(date);
  await c.updateOne(
    { date: key },
    {
      $set: {
        pages: state.pages || {},
        fullById: state.fullById || {},
        judgements: state.judgements || {},
        coverLetters: state.coverLetters || {},
      },
    },
    { upsert: true },
  );
}

export async function clear(): Promise<string[]> {
  const c = await col();
  const docs = await c.find({}, { projection: { date: 1 } }).toArray();
  const removed = docs.map(d => `cache:${d.date}`);
  if (removed.length) await c.deleteMany({});
  return removed;
}

export function fileFor(date?: Date): string {
  return `cache:${dateKey(date)}`;
}
