// Хранилище истории откликов в MongoDB.
import { connect, dbInstance } from "./db.js";
import { Collection } from "mongodb";

const COLLECTION = 'history';

interface HistoryDoc {
  vacancyId: string;
  status: 'seen' | 'applied';
  at: Date;
  meta?: Record<string, any>;
}

async function col(): Promise<Collection<HistoryDoc>> {
  await connect();
  const c = dbInstance().collection<HistoryDoc>(COLLECTION);
  await c.createIndex({ vacancyId: 1 }, { unique: true });
  return c;
}

export async function load(): Promise<{ applied: Record<string, any>; seen: Record<string, string> }> {
  const c = await col();
  const docs = await c.find({}).toArray();
  const applied: Record<string, any> = {};
  const seen: Record<string, string> = {};
  for (const d of docs) {
    if (d.status === 'applied') applied[d.vacancyId] = { at: d.at.toISOString(), ...d.meta };
    seen[d.vacancyId] = d.at.toISOString();
  }
  return { applied, seen };
}

export async function markApplied(vacancyId: string, meta: Record<string, any>): Promise<void> {
  const c = await col();
  await c.updateOne(
    { vacancyId: String(vacancyId) },
    { $set: { vacancyId: String(vacancyId), status: 'applied', at: new Date(), meta } },
    { upsert: true },
  );
}

export async function markSeen(vacancyId: string): Promise<void> {
  const c = await col();
  await c.updateOne(
    { vacancyId: String(vacancyId) },
    { $set: { vacancyId: String(vacancyId), status: 'seen', at: new Date() } },
    { upsert: true },
  );
}

export async function isApplied(vacancyId: string): Promise<boolean> {
  const c = await col();
  const doc = await c.findOne({ vacancyId: String(vacancyId), status: 'applied' });
  return Boolean(doc);
}

export async function isSeen(vacancyId: string): Promise<boolean> {
  const c = await col();
  const doc = await c.findOne({ vacancyId: String(vacancyId) });
  return Boolean(doc);
}

const _default = { load, markApplied, markSeen, isApplied, isSeen };
export default _default;
