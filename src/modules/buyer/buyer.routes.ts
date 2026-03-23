import { Router } from "express";
import { authenticate, requireRole } from "../../middleware/auth";
import { prisma } from "../../config/db";

const router = Router();
router.use(authenticate, requireRole("BUYER"));

/**
 * @swagger
 * /api/v1/buyer/dashboard:
 *   get:
 *     tags: [Buyer]
 *     summary: Get buyer dashboard
 *     description: Returns pending deliveries awaiting payment, payment history, and stats
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Buyer dashboard data
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 stats:
 *                   type: object
 *                   properties:
 *                     pendingCount: { type: integer, example: 3 }
 *                     paidCount:    { type: integer, example: 12 }
 *                     totalSpent:   { type: number,  example: 750000 }
 *                     unreadCount:  { type: integer, example: 2 }
 *                 pendingDeliveries: { type: array, items: { $ref: '#/components/schemas/Delivery' } }
 *                 paidDeliveries:    { type: array, items: { $ref: '#/components/schemas/Delivery' } }
 */
router.get("/dashboard", async (req, res, next) => {
  try {
    const [pending, paid] = await Promise.all([
      prisma.delivery.findMany({
        where:   { buyerId: req.user!.buyerId!, status: "PENDING" },
        include: {
          farmer:  { include: { user: { select: { name: true, phone: true } } } },
          receipt: true,
        },
        orderBy: { createdAt: "desc" },
      }),
      prisma.delivery.findMany({
        where:   { buyerId: req.user!.buyerId!, status: "PAID" },
        include: {
          farmer:  { include: { user: { select: { name: true } } } },
          receipt: true,
        },
        orderBy: { paidAt: "desc" },
        take:    20,
      }),
    ]);

    const totalSpent  = paid.reduce((s, d) => s + d.totalAmount, 0);
    const unreadCount = await prisma.notification.count({
      where: { userId: req.user!.userId, isRead: false },
    });

    res.json({
      success: true,
      stats:   { pendingCount: pending.length, paidCount: paid.length, totalSpent, unreadCount },
      pendingDeliveries: pending,
      paidDeliveries:    paid,
    });
  } catch (err) { next(err); }
});

export default router;
