import { Router } from "express";
import { authenticate, requireRole } from "../../middleware/auth";
import { prisma } from "../../config/db";
import { calculateCreditScore } from "../../lib/creditScore";

const router = Router();
router.use(authenticate, requireRole("FARMER"));

/**
 * @swagger
 * /api/v1/farmer/dashboard:
 *   get:
 *     tags: [Farmer]
 *     summary: Get farmer dashboard
 *     description: Returns wallet balance, credit score breakdown, loan eligibility, recent transactions, active loans, and deliveries
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Full farmer dashboard data
 */
router.get("/dashboard", async (req, res, next) => {
  try {
    const farmer = await prisma.farmer.findUnique({
      where:   { id: req.user!.farmerId! },
      include: {
        user:         { select: { name: true, phone: true, email: true } },
        transactions: { orderBy: { createdAt: "desc" }, take: 15 },
        loans:        { orderBy: { createdAt: "desc" }, take: 5 },
        deliveries: {
          orderBy: { createdAt: "desc" },
          take:    10,
          include: {
            buyer:   { include: { user: { select: { name: true } } } },
            receipt: true,
          },
        },
      },
    });

    if (!farmer) {
      res.status(404).json({ success: false, error: "Farmer not found" });
      return;
    }

    const allTx     = await prisma.transaction.findMany({ where: { farmerId: farmer.id } });
    const scoreData = calculateCreditScore(allTx, farmer);

    await prisma.farmer.update({
      where: { id: farmer.id },
      data:  { creditScore: scoreData.score },
    });

    const unreadCount = await prisma.notification.count({
      where: { userId: req.user!.userId, isRead: false },
    });

    res.json({ success: true, farmer: { ...farmer, ...scoreData, unreadCount } });
  } catch (err) { next(err); }
});

/**
 * @swagger
 * /api/v1/farmer/profile:
 *   patch:
 *     tags: [Farmer]
 *     summary: Update farmer profile
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               farmName:  { type: string, example: "Emeka Premium Farm" }
 *               location:  { type: string, example: "Kano State" }
 *               cropTypes: { type: array, items: { type: string }, example: ["Rice","Maize"] }
 *     responses:
 *       200:
 *         description: Profile updated successfully
 */
router.patch("/profile", async (req, res, next) => {
  try {
    const { farmName, location, cropTypes } = req.body;
    const farmer = await prisma.farmer.update({
      where: { id: req.user!.farmerId! },
      data: {
        ...(farmName  && { farmName }),
        ...(location  && { location }),
        ...(cropTypes && { cropTypes }),
      },
    });
    res.json({ success: true, farmer });
  } catch (err) { next(err); }
});

/**
 * @swagger
 * /api/v1/farmer/transactions:
 *   get:
 *     tags: [Farmer]
 *     summary: Get full transaction history
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: All farmer transactions
 */
router.get("/transactions", async (req, res, next) => {
  try {
    const transactions = await prisma.transaction.findMany({
      where:   { farmerId: req.user!.farmerId! },
      orderBy: { createdAt: "desc" },
      take:    50,
    });
    res.json({ success: true, transactions });
  } catch (err) { next(err); }
});

export default router;
