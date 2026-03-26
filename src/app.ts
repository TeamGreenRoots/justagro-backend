import express, { Application, Request, Response, NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { errorHandler, notFound } from "./middleware/errorHandler";

import authRoutes         from "./modules/auth/auth.routes";
import farmerRoutes       from "./modules/farmer/farmer.routes";
import withdrawalRoutes   from "./modules/farmer/withdrawal.routes";
import aggregatorRoutes   from "./modules/aggregator/aggregator.routes";
import inventoryRoutes    from "./modules/inventory/inventory.routes";
import transactionRoutes  from "./modules/transactions/transaction.routes";
import buyerContactRoutes from "./modules/buyer/buyer-contacts.routes";
import notificationRoutes from "./modules/notifications/notification.routes";
import aiRoutes           from "./modules/ai/ai.routes";

const app: Application = express();

app.use(helmet());
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);

    const allowed = [
      process.env.FRONTEND_URL || "",
      "http://localhost:3000",
      "http://localhost:3001",
      "https://justagro.vercel.app",
    ].filter(Boolean);

    if (
      allowed.includes(origin) ||
      origin.endsWith(".vercel.app") ||
      origin.endsWith(".onrender.com")
    ) {
      return callback(null, true);
    }

    console.warn("[CORS] Blocked origin:", origin);
    return callback(new Error("CORS: origin not allowed"), false);
  },
  credentials:    true,
  methods:        ["GET","POST","PUT","PATCH","DELETE","OPTIONS"],
  allowedHeaders: ["Content-Type","Authorization"],
  optionsSuccessStatus: 200,
}));

app.options("*", cors());

if (process.env.NODE_ENV !== "test") app.use(morgan("dev"));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

app.get("/health", (_req, res) => {
  res.json({
    status:    "healthy",
    service:   "JustAgro API v2",
    version:   "2.0.0",
    timestamp: new Date().toISOString(),
    env:       process.env.NODE_ENV || "development",
  });
});

app.use("/api-docs", (req: Request, res: Response, next: NextFunction) => {
  const swaggerUi   = require("swagger-ui-express");
  const { swaggerSpec } = require("./config/swagger");

  const serve = swaggerUi.serve;
  const setup  = swaggerUi.setup(swaggerSpec, {
    customCss:       ".swagger-ui .topbar { background: #064E3B; }",
    customSiteTitle: "JustAgro API Docs",
    swaggerOptions:  { persistAuthorization: true },
  });

  let i = 0;
  const runNext = (err?: any) => {
    if (err) return next(err);
    if (i < serve.length) {
      serve[i++](req, res, runNext);
    } else {
      setup(req, res, next);
    }
  };
  runNext();
});

app.get("/api-docs.json", (_req, res) => {
  const { swaggerSpec } = require("./config/swagger");
  res.setHeader("Content-Type", "application/json");
  res.send(swaggerSpec);
});

const API = "/api/v1";
app.use(`${API}/auth`,          authRoutes);
app.use(`${API}/farmer`,        farmerRoutes);
app.use(`${API}/farmer`,        withdrawalRoutes);
app.use(`${API}/farmers`,       farmerRoutes);
app.use(`${API}/aggregator`,    aggregatorRoutes);
app.use(`${API}/inventory`,     inventoryRoutes);
app.use(`${API}/transactions`,  transactionRoutes);
app.use(`${API}/buyer-contacts`,buyerContactRoutes);
app.use(`${API}/notifications`, notificationRoutes);
app.use(`${API}/ai`,            aiRoutes);

app.use(notFound);
app.use(errorHandler);

export default app;