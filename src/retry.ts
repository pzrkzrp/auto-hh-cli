import OpenAI from "openai";
import log from "./logger.js";

async function retryOnTransient(fn, maxRetries = 2) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= maxRetries) throw err;
      if (err instanceof OpenAI.RateLimitError || err instanceof OpenAI.InternalServerError || err instanceof OpenAI.APIError) {
        const delay = Math.min(1000 * Math.pow(2, attempt), 8000);
        log.debug(`retry attempt ${attempt + 1}/${maxRetries} after ${delay}ms: ${err.message}`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
}

export { retryOnTransient };
