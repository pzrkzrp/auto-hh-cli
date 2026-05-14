const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function writeDigest(entries) {
  if (!entries.length) return null;
  ensureDir();
  const file = path.join(DATA_DIR, `digest-${new Date().toISOString().slice(0, 10)}.json`);
  fs.writeFileSync(file, JSON.stringify(entries, null, 2));
  return file;
}

function writeRejected(entries) {
  if (!entries.length) return null;
  ensureDir();
  const file = path.join(DATA_DIR, `rejected-${new Date().toISOString().slice(0, 10)}.json`);
  fs.writeFileSync(file, JSON.stringify(entries, null, 2));
  return file;
}

module.exports = { writeDigest, writeRejected };
