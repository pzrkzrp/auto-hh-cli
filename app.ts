// Для обратной совместимости: `node app.js` = `auto-hh search`
import 'dotenv/config';
import search from './src/cli/cmd-search';

search()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Fatal:', err.message);
    process.exit(1);
  });
