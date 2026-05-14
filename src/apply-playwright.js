// Для обратной совместимости: `node src/apply-playwright.js` = `auto-hh apply`
const apply = require('./cli/cmd-apply');
const args = {
  login: process.argv.includes('--login'),
  limit: (() => {
    const idx = process.argv.indexOf('--limit');
    if (idx >= 0) {
      const n = parseInt(process.argv[idx + 1], 10);
      return Number.isFinite(n) ? n : undefined;
    }
    return undefined;
  })(),
};
apply(args)
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Fatal:', err.message);
    process.exit(1);
  });
