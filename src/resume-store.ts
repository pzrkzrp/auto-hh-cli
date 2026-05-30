// MongoDB-хранилище для коллекции resumes.
import { connect, dbInstance } from "./db.js";
import type { Resume } from "./types.js";

export interface ResumeDoc {
  resumeId: string;
  name: string;
  filename: string;
  createdAt: Date;
}

export async function listResumes(): Promise<ResumeDoc[]> {
  await connect();
  return dbInstance().collection<ResumeDoc>('resumes')
    .find({}, { sort: { createdAt: -1 } })
    .toArray();
}

export async function findResume(resumeId: string): Promise<ResumeDoc | null> {
  await connect();
  return dbInstance().collection<ResumeDoc>('resumes').findOne({ resumeId });
}

export async function registerResume(resume: Resume): Promise<void> {
  await connect();
  const doc: ResumeDoc = {
    resumeId: resume.id,
    name: resume.name,
    filename: resume.filename,
    createdAt: new Date(),
  };
  await dbInstance().collection<ResumeDoc>('resumes').updateOne(
    { resumeId: doc.resumeId },
    { $setOnInsert: doc },
    { upsert: true },
  );
}
