export interface Vacancy {
  id: number | string;
  name: string;
  description: string;
  key_skills?: { name: string }[];
  salary?: { from?: number; to?: number; currency?: string };
  employer?: { name?: string };
  area?: { name?: string };
  experience?: { name?: string };
  schedule?: { name?: string };
  employment?: { name?: string };
  [key: string]: unknown;
}

export interface Verdict {
  vacancyId: string;
  fit: boolean;
  score: number;
  reason: string | null;
  comment: string | null;
  coverLetter: string;
}

export interface JudgeOpts {
  minScore?: number;
  adaptResume?: boolean;
  [key: string]: unknown;
}

export interface Resume {
  name: string;
  id: string;
  type: 'text' | 'pdf';
  text?: string;
  data?: string;
  filename: string;
}

export interface DigestDoc {
  date: string;
  entries: DigestEntry[];
}

export interface DigestEntry {
  id: string;
  title: string;
  employer: string;
  area: string;
  salary: string;
  url: string;
  matchedSkills: string[];
  score: number;
  reason: string | null;
  coverLetter: string;
}
