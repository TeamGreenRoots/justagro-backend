import dotenv from "dotenv";
dotenv.config();

import app from "./app";

const PORT = process.env.PORT || 5000;

const server = app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════╗
║       JustAgro API v2                        ║
║   Port    : ${PORT}                              ║
║   Swagger : http://localhost:${PORT}/api-docs    ║
║   Health  : http://localhost:${PORT}/health      ║
║   Env     : ${(process.env.NODE_ENV || "development").padEnd(12)}                ║
╚══════════════════════════════════════════════╝
  `);
});

// Keep Render free tier alive 
// Render sleeps after 15 min inactivity - ping self every 14 min
if (process.env.NODE_ENV === "production") {
  const selfUrl = process.env.RENDER_EXTERNAL_URL || "";
  if (selfUrl) {
    setInterval(async () => {
      try {
        await fetch(`${selfUrl}/health`);
        console.log(`[Keep-alive] Pinged ${selfUrl}/health`);
      } catch (err) {
        console.warn("[Keep-alive] Ping failed:", err);
      }
    }, 14 * 60 * 1000); // every 14 minutes
    console.log(`[Keep-alive] Scheduled — pinging ${selfUrl}/health every 14 min`);
  }
}

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
