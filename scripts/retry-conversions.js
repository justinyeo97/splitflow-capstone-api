import "dotenv/config";
import { workerClient } from "../src/services/conversion-scheduler.js";
import { runConversionRetries } from "../src/services/retry-conversion.js";

try {
  console.log(JSON.stringify(await runConversionRetries(workerClient())));
} catch {
  console.error(
    "Conversion retry job failed; check database configuration and worker credentials.",
  );
  process.exitCode = 1;
}
