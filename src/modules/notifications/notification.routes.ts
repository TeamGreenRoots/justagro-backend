import { Router, Request, Response, NextFunction } from "express";
import { prisma } from "../../config/db";
import { authenticate } from "../../middleware/auth";

const router = Router();
router.use(authenticate);

/**
 * @swagger
 * /api/v1/notifications:
 *   get:
 *     tags: [Notifications]
 *     summary: Get user notifications (paginated)
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: unread
 *         schema: { type: boolean }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *     responses:
 *       200:
 *         description: Notifications with pagination
 */
router.get("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page       = Math.max(1, parseInt(req.query.page  as string) || 1);
    const limit      = Math.min(50, parseInt(req.query.limit as string) || 20);
    const skip       = (page - 1) * limit;
    const unreadOnly = req.query.unread === "true";

    const where: any = {
      userId: req.user!.userId,
      ...(unreadOnly ? { isRead: false } : {}),
    };

    const [items, total, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.notification.count({ where }),
      prisma.notification.count({ where: { userId: req.user!.userId, isRead: false } }),
    ]);

    res.json({
      success:    true,
      data:       items,
      unreadCount,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err) { next(err); }
});

router.patch("/:id/read", async (req: Request, res: Response, next: NextFunction) => {
  try {
    await prisma.notification.updateMany({
      where: { id: req.params.id, userId: req.user!.userId },
      data:  { isRead: true },
    });
    res.json({ success: true });
  } catch (err) { next(err); }
});

router.patch("/read-all", async (req: Request, res: Response, next: NextFunction) => {
  try {
    await prisma.notification.updateMany({
      where: { userId: req.user!.userId, isRead: false },
      data:  { isRead: true },
    });
    res.json({ success: true, message: "All marked as read" });
  } catch (err) { next(err); }
});

export default router;
