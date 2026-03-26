import dotenv from "dotenv";
dotenv.config();

import app from "./app";

const PORT = process.env.PORT || 5000;

const server = app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════╗
║   JustAgro API v2                        ║
║   Port    : ${PORT}                              ║
║   Swagger : http://localhost:${PORT}/api-docs    ║
║   Health  : http://localhost:${PORT}/health      ║
║   Env     : ${(process.env.NODE_ENV || "development").padEnd(12)}                ║
╚══════════════════════════════════════════════╝
  `);
});

process.on("SIGTERM", () => {
  server.close(() => {
    console.log("Server shut down gracefully");
    process.exit(0);
  });
});

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection:", reason);
});

export default server;
