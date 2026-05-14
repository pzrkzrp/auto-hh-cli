// Для обратной совместимости: `node index.js` = `auto-hh search`
const search = require('./src/cli/cmd-search');
search()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Fatal:', err.message);
    process.exit(1);
  });
