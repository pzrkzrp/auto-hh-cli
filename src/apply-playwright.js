// Автоотклик через Playwright.
// Использование:
//   1) npm run login — открывается браузер, вы вручную логинитесь на hh.ru.
//      Сессия сохраняется в PW_USER_DATA_DIR.
//   2) npm start    — генерирует свежий дайджест (data/digest-*.md) с отобранными вакансиями.
//   3) npm run apply — поднимает браузер на сохранённой сессии и откликается
//      на каждую вакансию из последнего дайджеста, вставляя сгенерированное письмо.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const log = require('./logger');
const history = require('./history');

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

// Ждём, пока пользователь нажмёт ENTER в консоли (для manual-режима тестов).
function waitForEnter(message) {
  return new Promise((resolve, reject) => {
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

// Эвристика: страница теста или страница с уже отправленным откликом.
async function detectPostState(page) {
  const url = page.url();
  if (/\/applicant\/vacancy_response\/test/.test(url)) return 'test';
  if (/\/applicant\/negotiations/.test(url)) return 'applied';
  return 'unknown';
}

// Парсит самый свежий digest-*.md, извлекает блоки {url, coverLetter, id}.
function loadLatestDigest() {
  const dir = path.join(__dirname, '..', 'data');
  if (!fs.existsSync(dir)) throw new Error('No data dir, run `npm start` first');
  const files = fs.readdirSync(dir)
    .filter(f => /^digest-.*\.md$/.test(f))
    .sort()
    .reverse();
  if (!files.length) throw new Error('No digest files. Run `npm start` first');
  const file = path.join(dir, files[0]);
  const text = fs.readFileSync(file, 'utf-8');
  log.info(`Using digest: ${file}`);

  const entries = [];
  // Делим по разделителю "---" и парсим поля.
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

async function loginFlow() {
  ensureProfile();
  log.info(`Launching headful browser, profile: ${PROFILE}`);
  log.info('Залогиньтесь на hh.ru вручную, потом просто закройте браузер.');
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    headless: false,
    viewport: { width: 1280, height: 800 },
  });
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto('https://hh.ru/account/login');
  // Ждём, пока пользователь сам закроет окно.
  await ctx.waitForEvent('close', { timeout: 0 }).catch(() => {});
}

async function applyToVacancy(page, entry) {
  log.info(`Open ${entry.url}`);
  await page.goto(entry.url, { waitUntil: 'domcontentloaded' });

  // Кнопка "Откликнуться". Селекторы у hh меняются — пробуем несколько.
  const respondSelectors = [
    'a[data-qa="vacancy-response-link-top"]',
    'a[data-qa="vacancy-response-link"]',
    'button[data-qa="vacancy-response-link-top"]',
    'button[data-qa="vacancy-response-link"]',
  ];
  let clicked = false;
  for (const sel of respondSelectors) {
    const el = await page.$(sel);
    if (el) {
      await el.click().catch(() => {});
      clicked = true;
      log.info(`Clicked respond (${sel})`);
      break;
    }
  }
  if (!clicked) {
    log.warn('Respond button not found, possibly already applied or test required');
    return { ok: false, reason: 'no respond button' };
  }

  await sleep(2000);

  // Тест от работодателя: либо пропускаем, либо отдаём управление пользователю.
  if (/\/applicant\/vacancy_response\/test/.test(page.url())) {
    if (TEST_MODE === 'skip') {
      log.warn('Test required, skipping (PW_TEST_MODE=skip)');
      return { ok: false, reason: 'test required' };
    }
    log.warn('Test required — переключаюсь в ручной режим.');
    if (HEADLESS) {
      log.warn('PW_HEADLESS=true: окно не видно. Перезапустите с PW_HEADLESS=false для ручного теста.');
      return { ok: false, reason: 'test required (headless)' };
    }
    try {
      await page.bringToFront();
      await waitForEnter(`Заполните тест в браузере для ${entry.url} и отправьте отклик.`);
    } catch (e) {
      log.warn(`Manual test wait aborted: ${e.message}`);
      return { ok: false, reason: 'manual test timeout' };
    }
    const state = await detectPostState(page);
    log.info(`После теста: state=${state}, url=${page.url()}`);
    return { ok: state === 'applied' || state === 'unknown', note: 'manual test handled' };
  }

  // Поле сопроводительного письма (открывается ссылкой "Добавить сопроводительное").
  const addLetterSelectors = [
    'button[data-qa="vacancy-response-letter-toggle"]',
    'a[data-qa="vacancy-response-letter-toggle"]',
  ];
  for (const sel of addLetterSelectors) {
    const el = await page.$(sel);
    if (el) { await el.click().catch(() => {}); break; }
  }

  const textareaSel = 'textarea[data-qa="vacancy-response-popup-form-letter-input"], textarea[name="text"]';
  const textarea = await page.waitForSelector(textareaSel, { timeout: 5000 }).catch(() => null);
  if (textarea && entry.coverLetter) {
    await textarea.fill(entry.coverLetter);
    log.info('Cover letter filled');
  }

  // Подтверждение отправки.
  const submitSelectors = [
    'button[data-qa="vacancy-response-submit-popup"]',
    'button[data-qa="vacancy-response-letter-submit"]',
    'button[data-qa="vacancy-response-submit"]',
  ];
  for (const sel of submitSelectors) {
    const btn = await page.$(sel);
    if (btn) {
      await btn.click().catch(() => {});
      log.info(`Submitted (${sel})`);
      await sleep(2500);
      return { ok: true };
    }
  }

  // Иногда отклик уходит сразу после первой кнопки (нет попапа).
  return { ok: true, note: 'no submit button found, possibly applied on first click' };
}

async function applyFlow() {
  ensureProfile();
  const entries = loadLatestDigest();
  log.info(`${entries.length} vacancies in digest`);

  const ctx = await chromium.launchPersistentContext(PROFILE, {
    headless: HEADLESS,
    viewport: { width: 1280, height: 800 },
  });
  const page = ctx.pages()[0] || await ctx.newPage();

  // Лёгкая проверка авторизации.
  await page.goto('https://hh.ru/applicant/resumes', { waitUntil: 'domcontentloaded' });
  if (/\/account\/login/.test(page.url())) {
    log.error('Not logged in. Run `npm run login` first.');
    await ctx.close();
    process.exit(1);
  }

  let ok = 0, fail = 0;
  for (const entry of entries) {
    const state = history.load();
    if (state.applied[entry.id]?.via === 'playwright') {
      log.info(`Skip ${entry.id}: already applied via playwright`);
      continue;
    }
    try {
      const res = await applyToVacancy(page, entry);
      if (res.ok) {
        history.markApplied(entry.id, { via: 'playwright', url: entry.url });
        ok++;
      } else {
        fail++;
      }
    } catch (err) {
      log.warn(`Apply failed for ${entry.id}: ${err.message}`);
      fail++;
    }
    const wait = rand(MIN_DELAY, MAX_DELAY);
    log.info(`Sleeping ${wait}ms`);
    await sleep(wait);
  }

  log.info(`Done. ok=${ok}, fail=${fail}`);
  await ctx.close();
}

async function main() {
  const isLogin = process.argv.includes('--login');
  if (isLogin) await loginFlow();
  else await applyFlow();
}

main().catch(err => {
  log.error('Fatal', { msg: err.message, stack: err.stack });
  process.exit(1);
});
