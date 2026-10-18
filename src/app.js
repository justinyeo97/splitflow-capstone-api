import "dotenv/config";
import { randomUUID } from "node:crypto";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { allowedOrigins } from "./config/env.js";
import { authClient, supabaseReady } from "./lib/supabase.js";
import { api } from "./routes/api.js";
import { errorHandler, notFound } from "./middleware/errors.js";

const app = express();
app.disable("x-powered-by");
app.use((req,res,next)=>{req.id=randomUUID();res.setHeader("x-request-id",req.id);next();});
app.use(helmet());
app.use(cors({ origin(origin, callback) { if (!origin || allowedOrigins.includes(origin)) return callback(null, true); return callback(new Error("Origin is not allowed")); }, credentials: true, methods: ["GET","POST","PATCH","PUT","DELETE","OPTIONS"], allowedHeaders: ["Authorization","Content-Type","X-Filename"] }));
app.use(express.json({ limit: "1mb" }));
app.use(express.text({ type: "text/csv", limit: "5mb" }));
app.get("/api/v1/health", (_req,res)=>res.json({status:"ok"}));
app.get("/api/v1/ready", async (_req,res)=>{
  if (!supabaseReady) return res.status(503).json({status:"not_ready",checks:{database:"not_configured"}});
  const {error}=await authClient.from("countries").select("id",{head:true,count:"exact"});
  return res.status(error?503:200).json({status:error?"not_ready":"ready",checks:{database:error?"unavailable":"ok"}});
});
app.use("/api/v1",api);
app.use(notFound);
app.use(errorHandler);
export default app;
