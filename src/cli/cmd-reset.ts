// Команда reset: сбросить историю, кэш и дайджесты.
import resetData from "../reset.js";

async function reset() {
  resetData();
}

export default reset;
