// Хранилище истории откликов в JSON-файле.
const fs = require('fs');
const path = require('path');

const HISTORY_FILE = path.join(__dirname, '..', 'data', 'history.json');

function ensureFile() {
  const dir = path.dirname(HISTORY_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(HISTORY_FILE)) {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify({ applied: {}, seen: {} }, null, 2));
  }
}

function load() {
  ensureFile();
  return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8'));
}

function save(state) {
  ensureFile();
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(state, null, 2));
}

function markApplied(vacancyId, meta) {
  const state = load();
  state.applied[vacancyId] = { at: new Date().toISOString(), ...meta };
  save(state);
}

function markSeen(vacancyId) {
  const state = load();
  state.seen[vacancyId] = new Date().toISOString();
  save(state);
}

function isApplied(vacancyId) {
  return Boolean(load().applied[vacancyId]);
}

function isSeen(vacancyId) {
  const s = load();
  return Boolean(s.seen[vacancyId] || s.applied[vacancyId]);
}

module.exports = { load, markApplied, markSeen, isApplied, isSeen };
