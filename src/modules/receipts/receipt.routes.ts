import { Router } from "express";
import { authenticate } from "../../middleware/auth";
import { prisma } from "../../config/db";
import { buildWhatsAppShareUrl } from "../../lib/receipt";

const router = Router();
router.use(authenticate);

/**
 * @swagger
 * /api/v1/receipts/{deliveryId}:
 *   get:
 *     tags: [Receipts]
 *     summary: Get digital receipt for a delivery
 *     description: |
 *       Returns the full receipt data plus a pre-filled WhatsApp share URL.
 *       The farmer can tap the WhatsApp URL to share their receipt directly.
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: deliveryId
 *         required: true
 *         schema: { type: string }
 *         example: "clx1234abcdef"
 *     responses:
 *       200:
 *         description: Receipt with WhatsApp share URL
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:     { type: boolean }
 *                 receipt:     { $ref: '#/components/schemas/Receipt' }
 *                 whatsappUrl: { type: string, example: "https://wa.me/?text=..." }
 *       404:
 *         description: Receipt not found — payment may not be confirmed yet
 */
router.get("/:deliveryId", async (req, res, next) => {
  try {
    const receipt = await prisma.receipt.findUnique({
      where:   { deliveryId: req.params.deliveryId },
      include: { delivery: { select: { status: true } } },
    });

    if (!receipt) {
      res.status(404).json({ success: false, error: "Receipt not found. Payment may not be confirmed yet." });
      return;
    }

    const whatsappUrl = buildWhatsAppShareUrl(receipt);

    res.json({ success: true, receipt: { ...receipt, whatsappUrl } });
  } catch (err) { next(err); }
});

/**
 * @swagger
 * /api/v1/receipts/code/{receiptCode}:
 *   get:
 *     tags: [Receipts]
 *     summary: Get receipt by receipt code (e.g. AGT-20241201-0001)
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: receiptCode
 *         required: true
 *         schema: { type: string }
 *         example: "AGT-20241201-0001"
 *     responses:
 *       200:
 *         description: Receipt data
 *       404:
 *         description: Receipt not found
 */
router.get("/code/:receiptCode", async (req, res, next) => {
  try {
    const receipt = await prisma.receipt.findUnique({
      where: { receiptCode: req.params.receiptCode },
    });

    if (!receipt) {
      res.status(404).json({ success: false, error: "Receipt not found" });
      return;
    }

    const whatsappUrl = buildWhatsAppShareUrl(receipt);
    res.json({ success: true, receipt: { ...receipt, whatsappUrl } });
  } catch (err) { next(err); }
});

export default router;
