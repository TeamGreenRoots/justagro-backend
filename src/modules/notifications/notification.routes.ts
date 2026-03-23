import { Router } from "express";
import { authenticate } from "../../middleware/auth";
import { prisma } from "../../config/db";

const router = Router();
router.use(authenticate);

/**
 * @swagger
 * /api/v1/notifications:
 *   get:
 *     tags: [Notifications]
 *     summary: Get user notifications
 *     description: Returns in-app notifications for the logged-in user (SMS and WhatsApp are sent externally)
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: unread
 *         schema: { type: boolean }
 *         description: If true, returns only unread notifications
 *     responses:
 *       200:
 *         description: List of notifications
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:       { type: boolean }
 *                 unreadCount:   { type: integer }
 *                 notifications:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:        { type: string }
 *                       message:   { type: string }
 *                       channel:   { type: string, enum: [SMS, WHATSAPP, IN_APP] }
 *                       isRead:    { type: boolean }
 *                       createdAt: { type: string, format: date-time }
 */
router.get("/", async (req, res, next) => {
  try {
    const unreadOnly = req.query.unread === "true";

    const [notifications, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where: {
          userId: req.user!.userId,
          ...(unreadOnly ? { isRead: false } : {}),
        },
        orderBy: { createdAt: "desc" },
        take:    50,
      }),
      prisma.notification.count({
        where: { userId: req.user!.userId, isRead: false },
      }),
    ]);

    res.json({ success: true, unreadCount, notifications });
  } catch (err) { next(err); }
});

/**
 * @swagger
 * /api/v1/notifications/{id}/read:
 *   patch:
 *     tags: [Notifications]
 *     summary: Mark a notification as read
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Notification marked as read
 */
router.patch("/:id/read", async (req, res, next) => {
  try {
    await prisma.notification.update({
      where: { id: req.params.id },
      data:  { isRead: true },
    });
    res.json({ success: true, message: "Marked as read" });
  } catch (err) { next(err); }
});

/**
 * @swagger
 * /api/v1/notifications/read-all:
 *   patch:
 *     tags: [Notifications]
 *     summary: Mark all notifications as read
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: All notifications marked as read
 */
router.patch("/read-all", async (req, res, next) => {
  try {
    await prisma.notification.updateMany({
      where: { userId: req.user!.userId, isRead: false },
      data:  { isRead: true },
    });
    res.json({ success: true, message: "All notifications marked as read" });
  } catch (err) { next(err); }
});

export default router;
