// Команда reset: сбросить историю, кэш и дайджесты.
import resetData from "../store/reset.js";

async function reset() {
  await resetData();
}

export default reset;
