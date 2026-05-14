// Команда reset: сбросить историю, кэш и дайджесты.
const resetData = require('../reset');

async function reset() {
  resetData();
}

module.exports = reset;
