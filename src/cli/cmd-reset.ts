// Команда reset: сбросить историю, кэш и дайджесты.
import resetData from "../reset.js";

async function reset() {
  await resetData();
}

export default reset;
