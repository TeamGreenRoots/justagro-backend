import { Request, Response, NextFunction } from "express";
import * as deliveryService from "./delivery.service";

export const listDeliveries = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tab, status } = req.query as { tab?: string; status?: string };
    const { role, farmerId, buyerId, aggregatorId, userId } = req.user!;

    const deliveries = await deliveryService.listDeliveries(
      userId, role, farmerId ?? undefined, buyerId ?? undefined,
      aggregatorId ?? undefined, tab, status
    );

    res.json({ success: true, deliveries });
  } catch (err) { next(err); }
};

export const getDelivery = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const delivery = await deliveryService.getDeliveryById(req.params.id);
    res.json({ success: true, delivery });
  } catch (err) { next(err); }
};

export const createDelivery = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { farmerId, buyerId, productName, quantity, pricePerKg } = req.body;

    if (!farmerId || !buyerId || !productName || !quantity || !pricePerKg) {
      res.status(400).json({
        success: false,
        error: "farmerId, buyerId, productName, quantity, pricePerKg are all required",
      });
      return;
    }

    const delivery = await deliveryService.createDelivery({
      farmerId,
      buyerId,
      productName,
      quantity:     parseFloat(quantity),
      pricePerKg:   parseFloat(pricePerKg),
      aggregatorId: req.user!.aggregatorId ?? undefined,
    });

    res.status(201).json({ success: true, delivery });
  } catch (err) { next(err); }
};

export const initiatePayment = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await deliveryService.startPayment(req.params.id, req.user!.buyerId!);
    res.json({ success: true, ...result });
  } catch (err) { next(err); }
};

export const verifyPayment = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { reference, paymentMethod } = req.body;
    if (!reference) {
      res.status(400).json({ success: false, error: "reference is required" });
      return;
    }
    const result = await deliveryService.confirmPayment(req.params.id, reference, paymentMethod);
    res.json({ success: true, ...result });
  } catch (err) { next(err); }
};
