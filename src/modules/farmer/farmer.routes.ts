import { Router, Request, Response, NextFunction } from "express";
import { prisma } from "../../config/db";
import { authenticate, requireRole } from "../../middleware/auth";
import { AppError } from "../../middleware/errorHandler";

const router = Router();

/**
 * @swagger
 * /api/v1/farmers:
 *   get:
 *     tags: [Aggregator]
 *     summary: List all farmers (aggregator only, paginated)
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 10 }
 *     responses:
 *       200:
 *         description: Farmer list with pagination
 */
router.get("/", authenticate, requireRole("AGGREGATOR"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page   = Math.max(1, parseInt(req.query.page  as string) || 1);
    const limit  = Math.min(50, parseInt(req.query.limit as string) || 10);
    const skip   = (page - 1) * limit;
    const search = req.query.search as string | undefined;

    const where: any = {};
    if (search) {
      where.OR = [
        { farmName: { contains: search, mode: "insensitive" } },
        { location: { contains: search, mode: "insensitive" } },
        { user:     { name: { contains: search, mode: "insensitive" } } },
      ];
    }

    const [farmers, total] = await Promise.all([
      prisma.farmer.findMany({
        where,
        include: {
          user:      { select: { name: true, phone: true, createdAt: true } },
          inventory: { where: { status: "AVAILABLE" }, select: { id: true, cropType: true, quantity: true, pricePerKg: true } },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.farmer.count({ where }),
    ]);

    res.json({
      success: true,
      data:    farmers,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err) { next(err); }
});

/**
 * @swagger
 * /api/v1/farmers/{id}:
 *   get:
 *     tags: [Aggregator]
 *     summary: Get farmer detail (aggregator) or own profile (farmer)
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Farmer detail with inventory and transactions
 */
router.get("/dashboard/me", authenticate, requireRole("FARMER"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const farmer = await prisma.farmer.findUnique({
      where:   { id: req.user!.farmerId! },
      include: {
        user:      { select: { name: true, phone: true } },
        inventory: { where: { status: "AVAILABLE" }, orderBy: { createdAt: "desc" } },
        transactions: {
          orderBy: { createdAt: "desc" },
          take:    15,
          include: {
            buyerContact: true,
            buyer:        { include: { user: { select: { name: true } } } },
            receipt:      { select: { id: true, txnRef: true } },
          },
        },
      },
    });

    if (!farmer) throw new AppError("Farmer not found", 404);

    const paidTxns   = farmer.transactions.filter(t => ["PAID", "ASSISTED"].includes(t.status));
    const pendingTxns = farmer.transactions.filter(t => t.status === "PENDING");

    const unreadCount = await prisma.notification.count({
      where: { userId: req.user!.userId, isRead: false },
    });

    res.json({
      success: true,
      data: {
        id:              farmer.id,
        farmName:        farmer.farmName,
        location:        farmer.location,
        cropTypes:       farmer.cropTypes,
        virtualAccountNo: farmer.virtualAccountNo,
        bankName:        farmer.bankName,
        walletBalance:   farmer.walletBalance,
        totalEarned:     farmer.totalEarned,
        user:            farmer.user,
        inventory:       farmer.inventory,
        recentTransactions: farmer.transactions.slice(0, 10),
        stats: {
          totalTransactions: farmer.transactions.length,
          paidCount:         paidTxns.length,
          pendingCount:      pendingTxns.length,
          availableStock:    farmer.inventory.length,
          unreadCount,
        },
      },
    });
  } catch (err) { next(err); }
});

/**
 * @swagger
 * /api/v1/farmer/profile:
 *   patch:
 *     tags: [Farmer]
 *     summary: Update own farm profile
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               farmName:  { type: string }
 *               location:  { type: string }
 *               cropTypes: { type: array, items: { type: string } }
 *     responses:
 *       200:
 *         description: Profile updated
 */
router.patch("/profile/me", authenticate, requireRole("FARMER"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { farmName, location, cropTypes } = req.body;
    const updated = await prisma.farmer.update({
      where: { id: req.user!.farmerId! },
      data: {
        ...(farmName  && { farmName }),
        ...(location  && { location }),
        ...(cropTypes && { cropTypes }),
      },
    });
    res.json({ success: true, data: updated });
  } catch (err) { next(err); }
});

export default router;

router.get("/:id", authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (req.user!.role === "FARMER" && req.params.id !== req.user!.farmerId) {
      throw new AppError("Forbidden", 403);
    }

    const farmer = await prisma.farmer.findUnique({
      where:   { id: req.params.id },
      include: {
        user: { select: { name: true, phone: true, email: true, createdAt: true } },
        inventory: {
          orderBy: { createdAt: "desc" },
        },
        transactions: {
          orderBy: { createdAt: "desc" },
          take: 10,
          include: {
            buyerContact: true,
            buyer:        { include: { user: { select: { name: true } } } },
            receipt:      true,
          },
        },
      },
    });

    if (!farmer) throw new AppError("Farmer not found", 404);

    res.json({ success: true, data: farmer });
  } catch (err) { next(err); }
});

/**
 * @swagger
 * /api/v1/farmer/dashboard:
 *   get:
 *     tags: [Farmer]
 *     summary: Farmer's own dashboard — wallet, earnings, transactions
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Dashboard data (NO credit score, NO loan info)
 */