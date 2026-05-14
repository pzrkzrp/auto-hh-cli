// Минимальный одноразовый HTTP-сервер для OAuth 2.0 callback hh.ru.
// Запуск: npm run auth — откройте выведенную ссылку, авторизуйтесь,
// сервер примет code, обменяет его на токены и сохранит в .env.
import 'dotenv/config';
import http from "http";
import url from "url";
import fs from "fs";
import path from "path";
import axios from "axios";

const env = {
  clientId: process.env.HH_CLIENT_ID,
  clientSecret: process.env.HH_CLIENT_SECRET,
  redirectUri: process.env.HH_REDIRECT_URI || 'http://localhost:3000/callback',
};

if (!env.clientId || !env.clientSecret) {
  console.error('HH_CLIENT_ID / HH_CLIENT_SECRET must be set in .env');
  process.exit(1);
}

const authUrl = `https://hh.ru/oauth/authorize?response_type=code&client_id=${env.clientId}&redirect_uri=${encodeURIComponent(env.redirectUri)}`;

console.log('\nOpen this URL in browser to authorize:\n');
console.log(authUrl + '\n');

function updateEnvFile(updates) {
  const envPath = path.resolve('.env');
  let text = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf-8') : '';
  for (const [k, v] of Object.entries(updates)) {
    const re = new RegExp(`^${k}=.*$`, 'm');
    if (re.test(text)) text = text.replace(re, `${k}=${v}`);
    else text += `\n${k}=${v}`;
  }
  fs.writeFileSync(envPath, text.trim() + '\n');
}

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  if (!parsed.pathname.endsWith('/callback')) {
    res.writeHead(404); res.end(); return;
  }
  const code = parsed.query.code;
  if (!code) {
    res.writeHead(400); res.end('No code'); return;
  }
  try {
    const { data } = await axios.post('https://api.hh.ru/token', new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: env.clientId,
      client_secret: env.clientSecret,
      redirect_uri: env.redirectUri,
      code,
    }).toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
      updateEnvFile({
      HH_ACCESS_TOKEN: data.access_token,
      HH_REFRESH_TOKEN: data.refresh_token,
    });
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Tokens saved to .env. You can close this tab.');
    console.log('Tokens saved. Shutting down.');
    setTimeout(() => process.exit(0), 500);
  } catch (e) {
    console.error('Token exchange failed:', e.response?.data || e.message);
    res.writeHead(500); res.end('Token exchange failed');
  }
});

server.listen(3000, () => console.log('Waiting for callback on http://localhost:3000/callback ...'));
