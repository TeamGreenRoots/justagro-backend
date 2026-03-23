import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import swaggerUi from "swagger-ui-express";

import { swaggerSpec } from "./config/swagger";
import { errorHandler } from "./middleware/errorHandler";
import { notFound } from "./middleware/notFound";

// Route Imports 
import authRoutes         from "./modules/auth/auth.routes";
import farmerRoutes       from "./modules/farmer/farmer.routes";
import buyerRoutes        from "./modules/buyer/buyer.routes";
import aggregatorRoutes   from "./modules/aggregator/aggregator.routes";
import deliveryRoutes     from "./modules/deliveries/delivery.routes";
import loanRoutes         from "./modules/loans/loan.routes";
import receiptRoutes      from "./modules/receipts/receipt.routes";
import notificationRoutes from "./modules/notifications/notification.routes";
import aiRoutes           from "./modules/ai/ai.routes";
import webhookRoutes      from "./modules/webhooks/webhook.routes";

const app = express();

// Security 
app.use(helmet());
app.use(cors({
  origin: [
    process.env.FRONTEND_URL || "http://localhost:3000",
    "http://localhost:3000",
    "http://localhost:3001",
  ],
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));

// Logging 
if (process.env.NODE_ENV !== "test") {
  app.use(morgan("dev"));
}

app.use("/api/webhooks", express.raw({ type: "application/json" }));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// Health Check 
app.get("/health", (_, res) => {
  res.json({
    status:    "healthy",
    service:   "JustAgro API",
    version:   "1.0.0",
    timestamp: new Date().toISOString(),
    env:       process.env.NODE_ENV,
  });
});

// Swagger Docs
app.use(
  "/api-docs",
  swaggerUi.serve,
  swaggerUi.setup(swaggerSpec, {
    customCss: ".swagger-ui .topbar { background: #16a34a; }",
    customSiteTitle: "JustAgro API Docs",
    customfavIcon: "🌾",
    swaggerOptions: {
      persistAuthorization: true,   // remembers your JWT between refreshes
    },
  })
);

// Raw swagger JSON (for Postman import)
app.get("/api-docs.json", (_, res) => {
  res.setHeader("Content-Type", "application/json");
  res.send(swaggerSpec);
});

// API Routes
const API = "/api/v1";

app.use(`${API}/auth`,          authRoutes);
app.use(`${API}/farmer`,        farmerRoutes);
app.use(`${API}/buyer`,         buyerRoutes);
app.use(`${API}/aggregator`,    aggregatorRoutes);
app.use(`${API}/deliveries`,    deliveryRoutes);
app.use(`${API}/loans`,         loanRoutes);
app.use(`${API}/receipts`,      receiptRoutes);
app.use(`${API}/notifications`, notificationRoutes);
app.use(`${API}/ai`,            aiRoutes);
app.use(`/api/webhooks`,        webhookRoutes);

// Error Handling 
app.use(notFound);
app.use(errorHandler);

export default app;
