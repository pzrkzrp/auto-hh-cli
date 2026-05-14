// Команда config: показать текущую конфигурацию.
const { loadConfig } = require('../config');

async function configCmd() {
  const cfg = loadConfig();
  console.log(JSON.stringify(cfg, null, 2));
}

module.exports = configCmd;
