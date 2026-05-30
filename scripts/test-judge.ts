import "dotenv/config";
import { judgeVacancy, judgeVacanciesBatch } from "../src/judge";
import { loadResume } from "../src/resume";

const resume = loadResume();
if (!resume || resume.type === "pdf") {
  console.error("Resume not found or is PDF", { path: process.env.RESUME_PATH });
  process.exit(1);
}
console.log("Resume loaded:", resume.filename, `(${resume.text!.length} chars)`);

const testVacancies = [
  {
    id: 1001,
    name: "Senior React Developer",
    description: "Разработка SPA на React+TypeScript. Требуется опыт от 3 лет с React, Redux, SSR. Знание Node.js приветствуется. Работа в офисе Москва.",
    key_skills: [{ name: "React" }, { name: "TypeScript" }, { name: "Redux" }, { name: "SSR" }],
    employer: { name: "TechCorp" },
    area: { name: "Москва" },
    experience: { name: "От 3 до 6 лет" },
    schedule: { name: "Полный день" },
    employment: { name: "Полная занятость" },
    salary: { from: 250000, to: 400000, currency: "RUR" },
  },
  {
    id: 1002,
    name: "Junior Angular Developer",
    description: "Разработка на Angular 2+. Требуется опыт от 0.5 года. Работа в офисе Казань.",
    key_skills: [{ name: "Angular" }, { name: "TypeScript" }],
    employer: { name: "Startup Inc" },
    area: { name: "Казань" },
    experience: { name: "От 1 года до 3 лет" },
    schedule: { name: "Полный день" },
    employment: { name: "Полная занятость" },
    salary: { from: 80000, to: 120000, currency: "RUR" },
  },
  {
    id: 1003,
    name: "PHP Developer (Drupal)",
    description: "Разработка на Drupal 10. Требуется опыт от 3 лет с Drupal, PHP, MySQL. Работа удалённо.",
    key_skills: [{ name: "PHP" }, { name: "Drupal" }, { name: "MySQL" }],
    employer: { name: "WebStudio" },
    area: { name: "Удалённо" },
    experience: { name: "От 3 до 6 лет" },
    schedule: { name: "Удалённая работа" },
    employment: { name: "Полная занятость" },
    salary: null,
  },
  {
    id: 1004,
    name: "Senior Fullstack Developer (NestJS/React)",
    description: "Fullstack разработка: React frontend + NestJS backend + PostgreSQL. Опыт от 4 лет. Москва, гибрид.",
    key_skills: [{ name: "React" }, { name: "TypeScript" }, { name: "NestJS" }, { name: "PostgreSQL" }, { name: "Docker" }, { name: "GitLab CI" }],
    employer: { name: "BigProduct" },
    area: { name: "Москва" },
    experience: { name: "От 3 до 6 лет" },
    schedule: { name: "Гибрид" },
    employment: { name: "Полная занятость" },
    salary: { from: 300000, to: 500000, currency: "RUR" },
  },
];

async function main() {
  console.log("\n=== Single judge ===");
  for (const v of testVacancies) {
    console.log(`\nJudging: ${v.name} (id=${v.id})`);
    const result = await judgeVacancy(resume as any, v, { minScore: 7 });
    console.log(
      result
        ? `  score=${result.score} fit=${result.fit} reason=${result.reason} comment=${result.comment}`
        : "  null (no client / parse error)"
    );
  }

  console.log("\n\n=== Batch judge ===");
  const batchResult = await judgeVacanciesBatch(resume as any, testVacancies, { minScore: 7 });
  if (batchResult) {
    for (const [id, v] of batchResult.entries()) {
      console.log(`  id=${id}: score=${v.score} fit=${v.fit}`);
    }
  } else {
    console.log("  batch returned null");
  }
}

main().catch(console.error);