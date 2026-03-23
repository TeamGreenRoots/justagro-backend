import { Router } from "express";
import { authenticate, requireRole } from "../../middleware/auth";
import { prisma } from "../../config/db";

const router = Router();
router.use(authenticate, requireRole("AGGREGATOR"));

/**
 * @swagger
 * /api/v1/aggregator/dashboard:
 *   get:
 *     tags: [Aggregator]
 *     summary: Full platform overview for aggregator
 *     description: Returns all deliveries, farmers, buyers, and platform revenue stats
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Aggregator dashboard
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 stats:
 *                   type: object
 *                   properties:
 *                     totalDeliveries:   { type: integer, example: 15 }
 *                     paidDeliveries:    { type: integer, example: 10 }
 *                     pendingDeliveries: { type: integer, example: 5  }
 *                     totalVolume:       { type: number,  example: 1250000 }
 *                     platformRevenue:   { type: number,  example: 12500 }
 *                     totalFarmers:      { type: integer, example: 8 }
 *                     totalBuyers:       { type: integer, example: 4 }
 */
router.get("/dashboard", async (req, res, next) => {
  try {
    const [deliveries, farmers, buyers] = await Promise.all([
      prisma.delivery.findMany({
        where:   { aggregatorId: req.user!.aggregatorId! },
        include: {
          farmer:  { include: { user: { select: { name: true } } } },
          buyer:   { include: { user: { select: { name: true } } } },
          receipt: true,
        },
        orderBy: { createdAt: "desc" },
      }),
      prisma.farmer.findMany({
        include: { user: { select: { name: true, phone: true } } },
        take:    100,
      }),
      prisma.buyer.findMany({
        include: { user: { select: { name: true, phone: true } } },
        take:    100,
      }),
    ]);

    const paid = deliveries.filter(d => d.status === "PAID");

    res.json({
      success: true,
      stats: {
        totalDeliveries:   deliveries.length,
        paidDeliveries:    paid.length,
        pendingDeliveries: deliveries.filter(d => d.status === "PENDING").length,
        totalVolume:       paid.reduce((s, d) => s + d.totalAmount, 0),
        platformRevenue:   paid.reduce((s, d) => s + (d.totalAmount * 0.01), 0),
        totalFarmers:      farmers.length,
        totalBuyers:       buyers.length,
      },
      recentDeliveries: deliveries.slice(0, 20),
      farmers,
      buyers,
    });
  } catch (err) { next(err); }
});

/**
 * @swagger
 * /api/v1/aggregator/farmers:
 *   get:
 *     tags: [Aggregator]
 *     summary: List all farmers on the platform
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: List of farmers with credit scores
 */
router.get("/farmers", async (req, res, next) => {
  try {
    const farmers = await prisma.farmer.findMany({
      include: {
        user:  { select: { name: true, phone: true, createdAt: true } },
        loans: { where: { status: { in: ["DISBURSED", "REPAYING"] } }, take: 1 },
      },
      orderBy: { creditScore: "desc" },
    });
    res.json({ success: true, farmers });
  } catch (err) { next(err); }
});

/**
 * @swagger
 * /api/v1/aggregator/buyers:
 *   get:
 *     tags: [Aggregator]
 *     summary: List all buyers on the platform
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: List of buyers
 */
router.get("/buyers", async (req, res, next) => {
  try {
    const buyers = await prisma.buyer.findMany({
      include: { user: { select: { name: true, phone: true, createdAt: true } } },
    });
    res.json({ success: true, buyers });
  } catch (err) { next(err); }
});

export default router;
