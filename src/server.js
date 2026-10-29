import app from "./app.js";
import { env } from "./config/env.js";

app.listen(env.PORT, () =>
  console.log(
    JSON.stringify({
      level: "info",
      message: "Splitflow API listening",
      port: env.PORT,
      environment: env.NODE_ENV,
    }),
  ),
);
