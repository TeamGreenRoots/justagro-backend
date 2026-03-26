import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

export interface AuthPayload {
  userId:       string;
  role:         string;
  farmerId?:    string | null;
  buyerId?:     string | null;
  aggregatorId?:string | null;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthPayload;
    }
  }
}

export const authenticate = (req: Request, res: Response, next: NextFunction): void => {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ success: false, error: "No token provided" });
    return;
  }
  try {
    const token   = header.split(" ")[1];
    const payload = jwt.verify(token, process.env.JWT_SECRET!) as AuthPayload;
    req.user      = payload;
    next();
  } catch {
    res.status(401).json({ success: false, error: "Invalid or expired token" });
  }
};

export const requireRole = (...roles: string[]) =>
  (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ success: false, error: "Unauthorized" });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({
        success: false,
        error:   `Access denied. Required: ${roles.join(" or ")}`,
      });
      return;
    }
    next();
  };
