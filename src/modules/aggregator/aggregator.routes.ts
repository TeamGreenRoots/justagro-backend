import { Router, Request, Response, NextFunction } from "express";
import { prisma } from "../../config/db";
import { authenticate, requireRole } from "../../middleware/auth";
import { AppError } from "../../middleware/errorHandler";

const router = Router();
router.use(authenticate, requireRole("AGGREGATOR"));

/**
 * @swagger
 * /api/v1/aggregator/dashboard:
 *   get:
 *     tags: [Aggregator]
 *     summary: Platform overview — stats, recent transactions
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Full aggregator dashboard
 */
router.get("/dashboard", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const aggId = req.user!.aggregatorId!;

    const [
      totalTxns,
      paidTxns,
      pendingTxns,
      assistedTxns,
      totalFarmers,
      totalContacts,
      availableStock,
      recentTxns,
    ] = await Promise.all([
      prisma.transaction.count({ where: { aggregatorId: aggId } }),
      prisma.transaction.findMany({ where: { aggregatorId: aggId, status: { in: ["PAID", "ASSISTED"] } }, select: { totalAmount: true, platformFee: true } }),
      prisma.transaction.count({ where: { aggregatorId: aggId, status: "PENDING" } }),
      prisma.transaction.count({ where: { aggregatorId: aggId, status: "ASSISTED" } }),
      prisma.farmer.count(),
      prisma.buyerContact.count({ where: { aggregatorId: aggId } }),
      prisma.inventory.count({ where: { status: "AVAILABLE" } }),
      prisma.transaction.findMany({
        where:   { aggregatorId: aggId },
        include: {
          farmer:       { include: { user: { select: { name: true } } } },
          buyerContact: true,
          buyer:        { include: { user: { select: { name: true } } } },
          receipt:      { select: { id: true } },
        },
        orderBy: { createdAt: "desc" },
        take:    10,
      }),
    ]);

    const totalVolume   = paidTxns.reduce((s, t) => s + t.totalAmount,  0);
    const totalRevenue  = paidTxns.reduce((s, t) => s + t.platformFee,  0);

    const unreadCount = await prisma.notification.count({
      where: { userId: req.user!.userId, isRead: false },
    });

    res.json({
      success: true,
      data: {
        stats: {
          totalTransactions: totalTxns,
          paidCount:         paidTxns.length,
          pendingCount:      pendingTxns,
          assistedCount:     assistedTxns,
          totalVolume,
          totalRevenue,
          totalFarmers,
          totalBuyerContacts: totalContacts,
          availableStock,
          unreadCount,
        },
        recentTransactions: recentTxns,
      },
    });
  } catch (err) { next(err); }
});

/**
 * @swagger
 * /api/v1/aggregator/register-farmer:
 *   post:
 *     tags: [Aggregator]
 *     summary: Register a farmer on their behalf (no smartphone needed)
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, phone, farmName, location]
 *             properties:
 *               name:      { type: string, example: "Musa Abdullahi" }
 *               phone:     { type: string, example: "08011223344" }
 *               farmName:  { type: string, example: "Musa Farms" }
 *               location:  { type: string, example: "Kano State" }
 *               cropTypes: { type: array, items: { type: string } }
 *     responses:
 *       201:
 *         description: Farmer registered
 */
router.post("/register-farmer", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, phone, farmName, location, cropTypes } = req.body;
    if (!name || !phone || !farmName || !location) {
      throw new AppError("name, phone, farmName, location are required", 400);
    }

    const existing = await prisma.user.findUnique({ where: { phone } });
    if (existing) throw new AppError("Phone number already registered", 409);

    // Default password = phone number (farmer can change later)
    const bcrypt = await import("bcryptjs");
    const passwordHash = await bcrypt.hash(phone, 12);

    const user = await prisma.user.create({
      data: {
        name, phone, passwordHash, role: "FARMER",
        farmer: {
          create: {
            farmName,
            location,
            cropTypes:    Array.isArray(cropTypes) ? cropTypes : [],
            registeredBy: req.user!.aggregatorId,
          },
        },
      },
      include: { farmer: true },
    });

    res.status(201).json({
      success: true,
      message: `Farmer registered. Default password is their phone number: ${phone}`,
      data: {
        userId:   user.id,
        farmerId: user.farmer!.id,
        name:     user.name,
        phone:    user.phone,
      },
    });
  } catch (err) { next(err); }
});

export default router;
