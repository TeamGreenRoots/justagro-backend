import { Router, Request, Response, NextFunction } from "express";
import { prisma } from "../../config/db";
import { authenticate, requireRole } from "../../middleware/auth";
import { AppError } from "../../middleware/errorHandler";

const router = Router();

/**
 * @swagger
 * /api/v1/inventory/browse:
 *   get:
 *     tags: [Inventory]
 *     summary: Browse available produce (public — no login needed)
 *     security: []
 */
router.get("/browse", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page     = Math.max(1, parseInt(req.query.page  as string) || 1);
    const limit    = Math.min(50, parseInt(req.query.limit as string) || 12);
    const skip     = (page - 1) * limit;
    const cropType = req.query.cropType as string | undefined;

    const where: any = { status: "AVAILABLE" };
    if (cropType) where.cropType = { contains: cropType, mode: "insensitive" };

    const [items, total] = await Promise.all([
      prisma.inventory.findMany({
        where,
        include: { farmer: { include: { user: { select: { name: true } } } } },
        orderBy: { createdAt: "desc" },
        skip, take: limit,
      }),
      prisma.inventory.count({ where }),
    ]);

    const cropTypes = await prisma.inventory.groupBy({
      by: ["cropType"], where: { status: "AVAILABLE" },
    });

    res.json({
      success: true, data: items,
      cropTypes:  cropTypes.map(c => c.cropType),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err) { next(err); }
});

router.use(authenticate);

/**
 * @swagger
 * /api/v1/inventory:
 *   get:
 *     tags: [Inventory]
 *     summary: List inventory (role-filtered)
 *     security:
 *       - BearerAuth: []
 */
router.get("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page   = Math.max(1, parseInt(req.query.page  as string) || 1);
    const limit  = Math.min(50, parseInt(req.query.limit as string) || 10);
    const skip   = (page - 1) * limit;
    const status = req.query.status as string | undefined;

    let where: any = {};

    if (req.user!.role === "FARMER") {
      where.farmerId = req.user!.farmerId;
    } else if (req.user!.role === "AGGREGATOR") {
      if (req.query.farmerId) where.farmerId = req.query.farmerId;
    } else {
      where.status = "AVAILABLE";
    }

    if (status) where.status = status;

    const [items, total] = await Promise.all([
      prisma.inventory.findMany({
        where,
        include: { farmer: { include: { user: { select: { name: true, phone: true } } } } },
        orderBy: { createdAt: "desc" }, skip, take: limit,
      }),
      prisma.inventory.count({ where }),
    ]);

    res.json({ success: true, data: items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (err) { next(err); }
});

/**
 * @swagger
 * /api/v1/inventory:
 *   post:
 *     tags: [Inventory]
 *     summary: Add inventory (farmer = own, aggregator = for offline farmer)
 *     security:
 *       - BearerAuth: []
 */
router.post("/", requireRole("FARMER","AGGREGATOR"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { cropType, quantity, pricePerKg, notes } = req.body;
    let   { farmerId } = req.body;

    if (!cropType || !quantity || !pricePerKg) throw new AppError("cropType, quantity, pricePerKg required", 400);

    if (req.user!.role === "FARMER") {
      farmerId = req.user!.farmerId!;
    } else {
      if (!farmerId) throw new AppError("farmerId required when adding stock for a farmer", 400);
    }

    const qty   = parseFloat(quantity);
    const price = parseFloat(pricePerKg);
    if (qty   <= 0) throw new AppError("Quantity must be > 0", 400);
    if (price <= 0) throw new AppError("Price must be > 0",    400);

    const item = await prisma.inventory.create({
      data: {
        farmerId, cropType: cropType.trim(), quantity: qty, pricePerKg: price,
        totalValue: qty * price, notes: notes || null, status: "AVAILABLE",
        addedById: req.user!.role === "AGGREGATOR" ? req.user!.aggregatorId! : undefined,
      },
      include: { farmer: { include: { user: { select: { name: true } } } } },
    });

    res.status(201).json({ success: true, data: item });
  } catch (err) { next(err); }
});

router.patch("/:id", requireRole("FARMER","AGGREGATOR"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await prisma.inventory.findUnique({ where: { id: req.params.id } });
    if (!item) throw new AppError("Not found", 404);
    if (item.status !== "AVAILABLE") throw new AppError(`Cannot edit — item is ${item.status}`, 400);
    if (req.user!.role === "FARMER" && item.farmerId !== req.user!.farmerId) throw new AppError("Forbidden", 403);

    const { cropType, quantity, pricePerKg, notes } = req.body;
    const qty   = quantity   ? parseFloat(quantity)   : item.quantity;
    const price = pricePerKg ? parseFloat(pricePerKg) : item.pricePerKg;

    const updated = await prisma.inventory.update({
      where: { id: req.params.id },
      data: { cropType: cropType || item.cropType, quantity: qty, pricePerKg: price, totalValue: qty * price, notes: notes !== undefined ? notes : item.notes },
    });
    res.json({ success: true, data: updated });
  } catch (err) { next(err); }
});

router.delete("/:id", requireRole("FARMER","AGGREGATOR"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await prisma.inventory.findUnique({ where: { id: req.params.id } });
    if (!item) throw new AppError("Not found", 404);
    if (item.status !== "AVAILABLE") throw new AppError("Cannot delete — item is reserved or sold", 400);
    if (req.user!.role === "FARMER" && item.farmerId !== req.user!.farmerId) throw new AppError("Forbidden", 403);
    await prisma.inventory.delete({ where: { id: req.params.id } });
    res.json({ success: true, message: "Deleted" });
  } catch (err) { next(err); }
});

export default router;