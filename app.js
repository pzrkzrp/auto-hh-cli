// Для обратной совместимости: `node app.js` = `auto-hh search`
require('dotenv').config();
const search = require('./src/cli/cmd-search');
search()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Fatal:', err.message);
    process.exit(1);
  });
