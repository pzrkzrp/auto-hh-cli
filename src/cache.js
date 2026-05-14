// Кэш собранных вакансий за текущую дату.
// Позволяет возобновить сбор после обрыва, не выгребая заново
// все страницы hh и не перезапрашивая getVacancy по каждой карточке.
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'data');

function fileFor(date = new Date()) {
  const day = date.toISOString().slice(0, 10);
  return path.join(DIR, `collected-${day}.json`);
}

function load(date) {
  const file = fileFor(date);
  if (!fs.existsSync(file)) return { pages: {}, fullById: {}, judgements: {}, coverLetters: {} };
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
    return {
      pages: data.pages || {},
      fullById: data.fullById || {},
      judgements: data.judgements || {},
      coverLetters: data.coverLetters || {},
    };
  } catch {
    return { pages: {}, fullById: {}, judgements: {}, coverLetters: {} };
  }
}

function save(state, date) {
  if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });
  const file = fileFor(date);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, file);
}

function clear() {
  if (!fs.existsSync(DIR)) return [];
  const removed = [];
  for (const name of fs.readdirSync(DIR)) {
    if (/^collected-.*\.json$/.test(name)) {
      const p = path.join(DIR, name);
      fs.unlinkSync(p);
      removed.push(p);
    }
  }
  return removed;
}

module.exports = { load, save, clear, fileFor };
