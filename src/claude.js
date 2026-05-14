const OpenAI = require('openai');

let client = null;
let lastConfig = null;

function getClient(apiConfig) {
  if (client && lastConfig === apiConfig) return client;

  const cfg = apiConfig || {};
  const key = cfg.apiKey || process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!key) return null;

  const opts = { apiKey: key, maxRetries: 3 };
  if (cfg.baseUrl) opts.baseURL = cfg.baseUrl;

  client = new OpenAI(opts);
  lastConfig = apiConfig;
  return client;
}

function stripHtml(s) {
  return (s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function parseJSON(text) {
  if (!text) return null;
  let cleaned = text.trim();
  cleaned = cleaned.replace(/^```json\s*\n?/i, '').replace(/\n?```\s*$/i, '');
  cleaned = cleaned.replace(/^\*\*+/, '').replace(/\*\*+$/, '');
  return JSON.parse(cleaned);
}

function buildResumeBlock(resume) {
  if (!resume) return null;
  if (resume.type === 'pdf') {
    return { type: 'text', text: `=== РЕЗЮМЕ СОИСКАТЕЛЯ (PDF) ===\n${resume.filename}` };
  }
  return { type: 'text', text: `=== РЕЗЮМЕ СОИСКАТЕЛЯ ===\n${resume.text}` };
}

module.exports = { getClient, stripHtml, parseJSON, buildResumeBlock };
