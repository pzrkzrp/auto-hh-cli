// Загрузка конфигурации из JSON и .env.
const fs = require('fs');
const path = require('path');

function loadConfig() {
  const configPath = process.env.CONFIG_PATH || './config.json';
  const absPath = path.resolve(configPath);
  if (!fs.existsSync(absPath)) {
    throw new Error(`Config not found: ${absPath}`);
  }
  const raw = fs.readFileSync(absPath, 'utf-8');
  return JSON.parse(raw);
}

function env() {
  return {
    clientId: process.env.HH_CLIENT_ID,
    clientSecret: process.env.HH_CLIENT_SECRET,
    redirectUri: process.env.HH_REDIRECT_URI || 'http://localhost:3000/callback',
    accessToken: process.env.HH_ACCESS_TOKEN,
    refreshToken: process.env.HH_REFRESH_TOKEN,
    userAgent: process.env.HH_USER_AGENT || 'AutoHH/1.0',
    resumeId: process.env.HH_RESUME_ID,
    requestDelayMs: parseInt(process.env.REQUEST_DELAY_MS || '1500', 10),
  };
}

module.exports = { loadConfig, env };
