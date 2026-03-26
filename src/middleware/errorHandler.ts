import { Request, Response, NextFunction } from "express";

export class AppError extends Error {
  constructor(public message: string, public statusCode: number) {
    super(message);
    this.name = "AppError";
  }
}

export const errorHandler = (
  err: any, req: Request, res: Response, next: NextFunction
): void => {
  console.error(`[${new Date().toISOString()}] ${req.method} ${req.path} —`, err.message);

  // Prisma unique constraint (check validation)
  if (err.code === "P2002") {
    res.status(409).json({ success: false, error: "Already exists", message: "A record with this value already exists" });
    return;
  }
  // Prisma not found
  if (err.code === "P2025") {
    res.status(404).json({ success: false, error: "Not found", message: "Record not found" });
    return;
  }

  const status  = err.statusCode || 500;
  const message = err.message    || "Something went wrong";

  res.status(status).json({
    success: false,
    error:   err.name || "Error",
    message,
    ...(process.env.NODE_ENV === "development" && { stack: err.stack }),
  });
};

export const notFound = (req: Request, res: Response): void => {
  res.status(404).json({
    success: false,
    error:   "Not Found",
    message: `${req.method} ${req.path} does not exist`,
  });
};
