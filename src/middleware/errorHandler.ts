import { Request, Response, NextFunction } from "express";

export class AppError extends Error {
  statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
    Error.captureStackTrace(this, this.constructor);
  }
}

export const errorHandler = (
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  console.error(`[ERROR] ${req.method} ${req.path}:`, err.message);

  // Prisma errors
  if (err.code === "P2002") {
    res.status(409).json({
      success: false,
      error:   "Conflict",
      message: "A record with this value already exists",
    });
    return;
  }

  if (err.code === "P2025") {
    res.status(404).json({
      success: false,
      error:   "Not Found",
      message: "Record not found",
    });
    return;
  }

  const statusCode = err.statusCode || 500;
  res.status(statusCode).json({
    success: false,
    error:   err.name || "Internal Server Error",
    message: err.message || "Something went wrong",
    ...(process.env.NODE_ENV === "development" && { stack: err.stack }),
  });
};


// notFound.ts (inline here for simplicity)
export const notFound = (req: Request, res: Response): void => {
  res.status(404).json({
    success: false,
    error:   "Not Found",
    message: `Route ${req.method} ${req.path} not found`,
  });
};


// validate.ts
import { ZodSchema } from "zod";

export const validate = (schema: ZodSchema) =>
  (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({
        success: false,
        error:   "Validation Error",
        message: result.error.errors.map(e => `${e.path.join(".")}: ${e.message}`).join(", "),
        errors:  result.error.errors,
      });
      return;
    }
    req.body = result.data;
    next();
  };
