// MongoDB connection manager.
import { MongoClient, Db } from "mongodb";

const URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/autohh';

let client: MongoClient | null = null;
let db: Db | null = null;

export async function connect(): Promise<Db> {
  if (db) return db;
  client = new MongoClient(URI);
  await client.connect();
  db = client.db();
  return db;
}

export function dbInstance(): Db {
  if (!db) throw new Error('MongoDB not connected. Call connect() first.');
  return db;
}

export async function close(): Promise<void> {
  if (client) await client.close();
  client = null;
  db = null;
}
