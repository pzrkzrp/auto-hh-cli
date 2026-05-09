// Клиент к hh.ru через Playwright-скрейпинг.
// API api.hh.ru заблокирован ddos-guard для нашего IP, поэтому ходим на основной
// сайт hh.ru как обычный браузер и забираем JSON из <template id="HH-Lux-InitialState">,
// в котором лежит полное состояние страницы (vacancySearchResult / vacancyView).
// Возвращаемые объекты приведены к формату прежнего API hh.ru, чтобы остальной код не менять.
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const { env } = require('./config');
const log = require('./logger');

const PROFILE = path.resolve(process.env.PW_USER_DATA_DIR || './data/browser-profile');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function decodeEntities(s) {
  if (!s) return '';
  return String(s)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

function mapCompensation(c) {
  if (!c) return null;
  if (c.noCompensation) return null;
  if (!c.from && !c.to) return null;
  return {
    from: c.from || null,
    to: c.to || null,
    currency: c.currencyCode || null,
    gross: c.gross,
  };
}

// Краткая запись (как в search response старого API).
function mapSearchItem(v) {
  return {
    id: String(v.vacancyId),
    name: v.name,
    employer: v.company ? { name: v.company.visibleName || v.company.name, id: v.company.id } : null,
    area: v.area ? { id: v.area['@id'], name: v.area.name } : null,
    salary: mapCompensation(v.compensation),
    alternate_url: v.links?.desktop || `https://hh.ru/vacancy/${v.vacancyId}`,
    snippet: v.snippet || null,
    archived: false,
    key_skills: [],
  };
}

// Полная запись (как в getVacancy старого API).
function mapVacancyView(v) {
  if (!v) return null;
  return {
    id: String(v.vacancyId),
    name: v.name,
    description: decodeEntities(v.description),
    employer: v.company ? { name: v.company.visibleName || v.company.name, id: v.company.id } : null,
    area: v.area ? { id: v.area['@id'], name: v.area.name } : null,
    salary: mapCompensation(v.compensation),
    key_skills: (v.keySkills?.keySkill || v.keySkills || []).map(k =>
      typeof k === 'string' ? { name: k } : { name: k.name || k.title || String(k) }
    ),
    experience: v.workExperience ? { name: v.workExperience.name || v.workExperience } : null,
    schedule: v.workScheduleByDays ? { name: (v.workScheduleByDays.name || (Array.isArray(v.workScheduleByDays) ? v.workScheduleByDays.join(', ') : '')) } : null,
    employment: v.employmentForm ? { name: v.employmentForm.name || v.employmentForm } : null,
    archived: !v.status?.active,
    alternate_url: `https://hh.ru/vacancy/${v.vacancyId}`,
  };
}

class HHClient {
  constructor() {
    const e = env();
    this.userAgent = e.userAgent;
    this.delay = e.requestDelayMs;
    this.ctx = null;
    this.page = null;
  }

  async init() {
    if (this.ctx) return;
    if (!fs.existsSync(PROFILE)) {
      throw new Error(`Browser profile not found: ${PROFILE}. Run \`npm run login\` first.`);
    }
    log.info('Launching Playwright context for hh.ru scraping');
    this.ctx = await chromium.launchPersistentContext(PROFILE, {
      headless: true,
      viewport: { width: 1280, height: 800 },
    });
    this.page = this.ctx.pages()[0] || await this.ctx.newPage();
  }

  async close() {
    if (this.ctx) {
      await this.ctx.close().catch(() => {});
      this.ctx = null;
      this.page = null;
    }
  }

  // Открывает url, парсит JSON из template#HH-Lux-InitialState.
  async fetchInitialState(url) {
    await this.init();
    await sleep(this.delay);
    const resp = await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    if (!resp || !resp.ok()) {
      const status = resp?.status() || 0;
      throw new Error(`HTTP ${status} ${url}`);
    }
    const json = await this.page.evaluate(() => {
      const tpl = document.querySelector('template#HH-Lux-InitialState');
      return tpl ? tpl.innerHTML : null;
    });
    if (!json) throw new Error(`No initial state on ${url}`);
    return JSON.parse(json);
  }

  async searchVacancies(params) {
    const sp = new URLSearchParams();
    if (params.text) sp.set('text', params.text);
    if (params.area != null) sp.set('area', String(params.area));
    if (params.experience) sp.set('experience', params.experience);
    if (params.salary) sp.set('salary', String(params.salary));
    if (params.only_with_salary) sp.set('only_with_salary', 'true');
    if (params.currency) sp.set('currency_code', params.currency);
    if (params.per_page) sp.set('items_on_page', String(params.per_page));
    if (params.page != null) sp.set('page', String(params.page));
    if (params.schedule) sp.set('schedule', params.schedule);
    if (params.employment) sp.set('employment', params.employment);

    const url = `https://hh.ru/search/vacancy?${sp.toString()}`;
    const data = await this.fetchInitialState(url);
    const vsr = data.vacancySearchResult;
    if (!vsr) {
      log.warn(`No vacancySearchResult on ${url}`);
      return { items: [], found: 0, pages: 0 };
    }
    const items = (vsr.vacancies || []).map(mapSearchItem);
    const found = vsr.totalResults || items.length;
    const perPage = params.per_page || 50;
    const pages = vsr.paging?.lastPage?.page != null
      ? vsr.paging.lastPage.page + 1
      : Math.ceil(found / perPage);
    return { items, found, pages };
  }

  async getVacancy(id) {
    const url = `https://hh.ru/vacancy/${id}`;
    const data = await this.fetchInitialState(url);
    return mapVacancyView(data.vacancyView);
  }
}

module.exports = HHClient;
