import dotenv from "dotenv";
dotenv.config();

import app from "./app";

const PORT = process.env.PORT || 5000;

const server = app.listen(PORT, () => {
  console.log(`
  ╔═══════════════════════════════════════╗
  ║   JustAgro API Server Running         ║
  ║   Port     : ${PORT}                  ║
  ║   Env: ${process.env.NODE_ENV || "development"}   ║
  ║   Docs: http://localhost:${PORT}/api-docs ║
  ╚═══════════════════════════════════════╝
  `);
});

// shutdown
process.on("SIGTERM", () => {
  console.log("SIGTERM received. Shutting down...");
  server.close(() => process.exit(0));
});

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled Rejection:", reason);
  server.close(() => process.exit(1));
});

export default server;
