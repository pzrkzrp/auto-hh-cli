// Команда apply: отклик через Playwright.
import fs from "fs";
import path from "path";
import {  chromium  } from "playwright";
import log from "../logger.js";
import history from "../history.js";

const PROFILE = path.resolve(process.env.PW_USER_DATA_DIR || './data/browser-profile');
const HEADLESS = String(process.env.PW_HEADLESS || 'false') === 'true';
const MIN_DELAY = parseInt(process.env.PW_MIN_DELAY_MS || '500', 10);
const MAX_DELAY = parseInt(process.env.PW_MAX_DELAY_MS || '2000', 10);
const TEST_MODE = (process.env.PW_TEST_MODE || 'manual').toLowerCase();
const TEST_TIMEOUT = parseInt(process.env.PW_TEST_TIMEOUT_MS || '0', 10);

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

function ensureProfile() {
  if (!fs.existsSync(PROFILE)) fs.mkdirSync(PROFILE, { recursive: true });
}

function loadLatestDigest() {
  const dir = path.join(__dirname, '..', '..', 'data');
  if (!fs.existsSync(dir)) throw new Error('No data dir, run `auto-hh search` first');
  const files = fs.readdirSync(dir)
    .filter(f => /^digest-.*\.(json|md)$/.test(f))
    .sort()
    .reverse();
  if (!files.length) throw new Error('No digest files. Run `auto-hh search` first');
  const file = path.join(dir, files[0]);
  log.info(`Using digest: ${file}`);

  if (file.endsWith('.json')) {
    const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
    const entries = Array.isArray(data) ? data : (data.matched || []);
    return entries.map(e => ({
      id: String(e.id),
      url: e.url,
      coverLetter: e.coverLetter || '',
      title: e.title,
      employer: e.employer,
    }));
  }

  // Парсинг старого формата .md
  const text = fs.readFileSync(file, 'utf-8');
  const entries = [];
  for (const block of text.split(/\n---\n/)) {
    const url = block.match(/Ссылка:\s*(\S+)/)?.[1];
    const cover = block.match(/\*\*Сопроводительное:\*\*\n\n([\s\S]*?)$/m)?.[1]?.trim();
    if (!url) continue;
    const id = url.match(/vacancy\/(\d+)/)?.[1];
    if (!id) continue;
    entries.push({ id, url, coverLetter: cover || '' });
  }
  return entries;
}

async function applyToVacancy(page, entry) {
  log.info(`Applying to ${entry.id} (${entry.employer || '?'}: ${entry.title})`);
  const minDelay = parseInt(process.env.PW_MIN_DELAY_MS || '500', 10);
  const maxDelay = parseInt(process.env.PW_MAX_DELAY_MS || '2000', 10);
  await page.goto(entry.url, { waitUntil: 'domcontentloaded' });
  await sleep(rand(minDelay, maxDelay));

  // Пробуем разные селекторы кнопки отклика.
  const selectors = [
    'a[data-qa="vacancy-response-link-top"]',
    'a[data-qa="vacancy-response-link"]',
    'button[data-qa="vacancy-response-link-top"]',
    'a[href^="/applicant/vacancy_response"]',
  ];
  let btnClicked = false;
  for (const sel of selectors) {
    const el = await page.$(sel);
    if (el) {
      await el.click().catch(() => {});
      btnClicked = true;
      break;
    }
  }
  if (!btnClicked) {
    log.warn(`No response button found for ${entry.id}`);
    return { ok: false, reason: 'no response button' };
  }

  await sleep(rand(1500, 3000));

  // Проверяем тестовое задание.
  const postState = await detectPostState(page);
  if (postState === 'test') {
    log.warn(`Test required for ${entry.id}`);
    if (TEST_MODE === 'skip') return { ok: false, reason: 'test required' };
    if (TEST_MODE === 'manual') {
      try {
        await waitForEnter(`Тест для вакансии "${entry.title}" (${entry.url}). Пройдите тест в браузере.`);
      } catch (e) {
        log.warn(`Manual test timeout for ${entry.id}: ${e.message}`);
        return { ok: false, reason: e.message };
      }
    }
  }
  if (postState === 'applied') {
    log.info(`Already applied (no popup): ${entry.id}`);
    return { ok: true, note: 'already applied' };
  }

  // Новая форма отклика (полностраничная, без попапа): раскрываем поле письма
  const letterToggle = await page.$('[data-qa="vacancy-response-letter-toggle"]');
  if (letterToggle) {
    await letterToggle.click();
    await sleep(rand(500, 1000));
  }

  // Заполняем сопроводительное.
  const textareaSel = 'textarea[data-qa="vacancy-response-popup-form-letter-input"], textarea[name="text"], textarea[data-qa*="letter"]';
  const textarea = await page.waitForSelector(textareaSel, { timeout: 8000 }).catch(() => null);
  if (textarea && entry.coverLetter) {
    await textarea.fill(entry.coverLetter);
    log.info('Cover letter filled');
  } else if (entry.coverLetter) {
    const dumpPath = path.join(__dirname, '..', '..', 'data', `apply-dom-${entry.id}.html`);
    try {
      const html = await page.content();
      fs.writeFileSync(dumpPath, html);
      log.warn(`Letter textarea NOT found. Dumped DOM to ${dumpPath}`);
    } catch (_) {}
    return { ok: false, reason: 'letter textarea not found — refusing to submit without cover letter' };
  }

  // Подтверждение отправки — предпочитаем кнопку «без теста».
  const submitSelectors = [
    'button[data-qa="vacancy-response-link-no-questions"]',
    'button[data-qa="vacancy-response-submit-popup"]',
    'button[data-qa*="submit"]',
    'button[type="submit"]',
  ];
  for (const sel of submitSelectors) {
    const el = await page.$(sel);
    if (el) { await el.click().catch(() => {}); break; }
  }

  await sleep(rand(1500, 3000));

  const post = await detectPostState(page);
  if (post === 'test') {
    log.warn(`Test required after submit for ${entry.id}`);
    if (TEST_MODE === 'skip') return { ok: false, reason: 'test required' };
    if (TEST_MODE === 'manual') {
      try {
        await waitForEnter(`Тест для вакансии "${entry.title}" (${entry.url}). Пройдите тест в браузере.`);
      } catch (e) {
        log.warn(`Manual test timeout for ${entry.id}: ${e.message}`);
        return { ok: false, reason: e.message };
      }
    }
  }
  if (post !== 'applied') {
    const state = await detectPostState(page);
    if (state === 'unknown') {
      const postUrl = page.url();
      log.info(`Submit done, landed on ${postUrl}`);
    }
  }

  return { ok: true };
}

async function detectPostState(page) {
  const url = page.url();
  if (/\/applicant\/vacancy_response\/test/.test(url)) return 'test';
  if (/\/applicant\/negotiations/.test(url)) return 'applied';
  return 'unknown';
}

function waitForEnter(message) {
  return new Promise<void>((resolve, reject) => {
    process.stdout.write(`\n>>> ${message}\n>>> Нажмите ENTER в этой консоли, когда закончите...\n`);
    let timer;
    const onData = () => {
      process.stdin.removeListener('data', onData);
      process.stdin.pause();
      if (timer) clearTimeout(timer);
      resolve();
    };
    process.stdin.resume();
    process.stdin.once('data', onData);
    if (TEST_TIMEOUT > 0) {
      timer = setTimeout(() => {
        process.stdin.removeListener('data', onData);
        process.stdin.pause();
        reject(new Error('manual test timeout'));
      }, TEST_TIMEOUT);
    }
  });
}

async function loginFlow() {
  ensureProfile();
  log.info(`Launching headful browser, profile: ${PROFILE}`);
  log.info('Залогиньтесь на hh.ru вручную, потом просто закройте браузер.');
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    headless: false,
    viewport: { width: 1280, height: 800 },
  });
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto('https://hh.ru/account/login', { waitUntil: 'domcontentloaded' });
  await new Promise(() => {}); // бесконечное ожидание — браузер жив, пока не закроют.
}

async function apply(opts: Record<string, any> = {}) {
  if (opts.login) {
    await loginFlow();
    return;
  }

  ensureProfile();
  const entries = loadLatestDigest();

  if (opts.limit && Number.isFinite(opts.limit) && opts.limit > 0) {
    entries.splice(opts.limit);
    log.info(`Limit applied: ${opts.limit} vacancies`);
  }
  log.info(`${entries.length} vacancies in digest`);

  const ctx = await chromium.launchPersistentContext(PROFILE, {
    headless: HEADLESS,
    viewport: { width: 1280, height: 800 },
  });
  const page = ctx.pages()[0] || await ctx.newPage();

  // Проверка авторизации.
  await page.goto('https://hh.ru/applicant/resumes', { waitUntil: 'domcontentloaded' });
  if (/\/account\/login/.test(page.url())) {
    log.error('Not logged in. Run `auto-hh apply --login` first.');
    await ctx.close();
    process.exit(1);
  }

  let ok = 0, fail = 0;
  for (const entry of entries) {
    const state = await history.load();
    const rec = state.applied[entry.id];
    if (rec && !rec.digestOnly) {
      log.info(`Skip ${entry.id}: already applied`);
      continue;
    }
    try {
      const res = await applyToVacancy(page, entry);
      if (res.ok) {
        await history.markApplied(entry.id, { via: 'playwright', url: entry.url });
        ok++;
      } else {
        fail++;
      }
    } catch (err) {
      log.warn(`Apply failed for ${entry.id}: ${err.message}`);
      fail++;
    }
    await sleep(rand(MIN_DELAY, MAX_DELAY));
  }

  log.info(`Done. ok=${ok}, fail=${fail}`);
  await ctx.close();
}

export default apply;
