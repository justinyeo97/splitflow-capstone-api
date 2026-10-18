import cors from "cors";
import express from "express";
import helmet from "helmet";

const app = express();
const frontendUrl = process.env.FRONTEND_URL;

app.use(helmet());
if (frontendUrl) {
  app.use(cors({ origin: frontendUrl }));
}
app.use(express.json());

app.get("/health", (_request, response) => {
  response.json({ status: "ok" });
});

export default app;