import { Request, Response, NextFunction } from "express";
import * as aiService from "./ai.service";

export const scoreExplainer = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const explanation = await aiService.explainCreditScore(req.user!.farmerId!);
    res.json({ success: true, explanation });
  } catch (err) { next(err); }
};

export const fraudCheck = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await aiService.detectFraud(req.params.deliveryId);
    res.json({ success: true, result });
  } catch (err) { next(err); }
};

export const priceIntelligence = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const report = await aiService.getPriceIntelligence(req.params.deliveryId);
    res.json({ success: true, report });
  } catch (err) { next(err); }
};
