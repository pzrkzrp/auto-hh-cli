// Команда apply: отклик через Playwright.
import fs from "fs";
import path from "path";
import {  chromium  } from "playwright";
import log from "../logger";
import history from "../history-store";
import  {getDigestsByDate, getAllDigests} from "../digest-store";

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

async function loadDigest(type: string) {
  if (type === 'all') {
    log.info('Loading all digests');
    return getAllDigests('digest');
  }
  const date = new Date().toISOString().slice(0, 10);
  return getDigestsByDate('digest', date);
}

async function applyToVacancy(page, entry) {
  log.info(`Applying to ${entry.id} (${entry.employer || '?'}: ${entry.title})`);
  const minDelay = parseInt(process.env.PW_MIN_DELAY_MS || '500', 10);
  const maxDelay = parseInt(process.env.PW_MAX_DELAY_MS || '2000', 10);
  await page.goto(entry.url, { waitUntil: 'domcontentloaded' });
  await sleep(rand(minDelay, maxDelay));

  // Проверяем, не откликались ли уже (по странице, а не по локальной истории).
  const alreadyResponded = await checkAlreadyResponded(page);
  if (alreadyResponded) {
    log.info(`Already applied (detected on page): ${entry.id}`);
    return { ok: true, note: 'already applied (page)' };
  }

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

  // Ручное подтверждение: пользователь сам нажимает «Откликнуться» в браузере.
  log.info(`\n>>> Вакансия "${entry.title || entry.id}" @ ${entry.employer || '?'}`);
  log.info(`>>> Сопроводительное заполнено. Проверьте и нажмите «Откликнуться» в браузере.`);
  log.info(`>>> Ожидание...`);

  const manualTimeout = parseInt(process.env.PW_MANUAL_TIMEOUT_MS || '300000', 10);
  const hadTextarea = !!textarea;
  let submitted = false;

  try {
    await page.waitForFunction(
      (args) => {
        const url = window.location.href;
        // Полностраничная форма: редирект на negotiations/test
        if (url.includes('/applicant/negotiations/') || url.includes('/applicant/vacancy_response/test')) {
          return true;
        }
        // Попап-форма: окно с полем ввода закрылось
        if (args.hadTextarea && !document.querySelector(args.textareaSel)) {
          return true;
        }
        // Запасной вариант: кнопка отклика исчезла или стала ссылкой на negotiations
        const btn = document.querySelector('a[data-qa="vacancy-response-link-top"], a[data-qa="vacancy-response-link"]');
        if (btn && btn.getAttribute('href')?.includes('/applicant/negotiations/')) {
          return true;
        }
        return false;
      },
      { textareaSel, hadTextarea },
      { timeout: manualTimeout, polling: 500 },
    );
    submitted = true;
  } catch (e) {
    log.warn(`Manual submit wait timeout for ${entry.id}`);
  }

  if (!submitted) {
    return { ok: false, reason: 'manual submit timeout' };
  }

  const afterSubmitState = await detectPostState(page);
  if (afterSubmitState === 'test') {
    log.warn(`Test required for ${entry.id}`);
    if (TEST_MODE === 'skip') return { ok: false, reason: 'test required' };
    if (TEST_MODE === 'manual') {
      try {
        await waitForEnter(`Тест для вакансии "${entry.title || entry.id}" (${entry.url}). Пройдите тест в браузере.`);
      } catch (e) {
        log.warn(`Manual test timeout for ${entry.id}: ${e.message}`);
        return { ok: false, reason: e.message };
      }
    }
  }

  log.info(`Submitted: ${entry.id} @ ${entry.employer || '?'}`);
  return { ok: true };
}

async function detectPostState(page) {
  const url = page.url();
  if (/\/applicant\/vacancy_response\/test/.test(url)) return 'test';
  if (/\/applicant\/negotiations/.test(url)) return 'applied';
  return 'unknown';
}

// Проверяет, не откликались ли уже на эту вакансию, по содержимому страницы.
async function checkAlreadyResponded(page) {
  // 1. Кнопка отклика — ссылка на negotiations (уже откликнулись)
  const respondedLink = await page.$('a[data-qa="vacancy-response-link-top"][href*="negotiation"], a[data-qa="vacancy-response-link"][href*="negotiation"]');
  if (respondedLink) return true;

  // 2. Текст "Вы откликнулись" на странице
  const bodyText = await page.evaluate(() => document.body?.innerText?.slice(0, 500) || '');
  if (/вы\s+откликнулись/i.test(bodyText)) return true;

  // 3. URL уже на negotiations (редирект)
  if (/\/applicant\/negotiations/.test(page.url())) return true;

  return false;
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
  const type = opts.type || 'latest';
  const entries = await loadDigest(type);

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
