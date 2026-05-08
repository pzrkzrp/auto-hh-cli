// Тонкий клиент к публичному API hh.ru (без авторизации).
// Соискательская часть API отключена с 15.12.2025, поэтому остался только поиск.
const axios = require('axios');
const { env } = require('./config');
const log = require('./logger');

const BASE = 'https://api.hh.ru';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

class HHClient {
  constructor() {
    const e = env();
    this.userAgent = e.userAgent;
    this.delay = e.requestDelayMs;
    this.http = axios.create({
      baseURL: BASE,
      headers: {
        'User-Agent': this.userAgent,
        'HH-User-Agent': this.userAgent,
      },
    });
  }

  async request(method, url, options = {}) {
    await sleep(this.delay);
    try {
      const resp = await this.http.request({
        method, url,
        params: options.params,
      });
      return resp.data;
    } catch (err) {
      const status = err.response?.status;
      log.error(`HTTP ${status} ${method} ${url}`, err.response?.data || err.message);
      throw err;
    }
  }

  searchVacancies(params) {
    return this.request('GET', '/vacancies', { params });
  }

  getVacancy(id) {
    return this.request('GET', `/vacancies/${id}`);
  }
}

module.exports = HHClient;
