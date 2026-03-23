import { Request, Response, NextFunction } from "express";
import * as authService from "./auth.service";

export const register = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await authService.registerUser(req.body);
    res.status(201).json({ success: true, ...result });
  } catch (err) { next(err); }
};

export const login = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { phone, password } = req.body;
    if (!phone || !password) {
      res.status(400).json({ success: false, error: "phone and password are required" });
      return;
    }
    const result = await authService.loginUser(phone, password);
    res.json({ success: true, ...result });
  } catch (err) { next(err); }
};

export const refreshToken = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      res.status(400).json({ success: false, error: "refreshToken is required" });
      return;
    }
    const result = await authService.refreshAccessToken(refreshToken);
    res.json({ success: true, ...result });
  } catch (err) { next(err); }
};

export const getMe = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = await authService.getUserById(req.user!.userId);
    res.json({ success: true, user });
  } catch (err) { next(err); }
};
