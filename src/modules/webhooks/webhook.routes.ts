import { Router } from "express";
import crypto from "crypto";
import { prisma } from "../../config/db";

const router = Router();

/**
 * @swagger
 * /api/webhooks/interswitch:
 *   post:
 *     tags: [Webhooks]
 *     summary: Interswitch payment webhook
 *     description: |
 *       Interswitch calls this endpoint automatically when a payment is made to a farmer's virtual account.
 *       **Do not call this manually in production.**
 *       For testing, you can simulate a payment by sending the payload below.
 *     security: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               accountNumber:        { type: string, example: "0123456789" }
 *               amount:               { type: string, example: "90000" }
 *               transactionReference: { type: string, example: "ISW_TXN_001" }
 *               paymentMethod:        { type: string, example: "CARD" }
 *               senderName:           { type: string, example: "AgroMart Nigeria" }
 *     responses:
 *       200:
 *         description: Webhook acknowledged
 */
router.post("/interswitch", async (req, res, next) => {
  try {
    const signature = req.headers["x-interswitch-signature"] as string | undefined;
    const rawBody   = req.body instanceof Buffer ? req.body : Buffer.from(JSON.stringify(req.body));

    // Verify signature if secret is set
    if (process.env.INTERSWITCH_WEBHOOK_SECRET && signature) {
      const expected = crypto
        .createHmac("sha512", process.env.INTERSWITCH_WEBHOOK_SECRET)
        .update(rawBody)
        .digest("hex");

      if (expected !== signature) {
        console.warn("[Webhook] Invalid signature — rejected");
        res.status(401).json({ error: "Invalid signature" });
        return;
      }
    }

    const payload = JSON.parse(rawBody.toString());
    const { accountNumber, amount, transactionReference, senderName } = payload;

    console.log("[Webhook] Interswitch payment received:", { accountNumber, amount, transactionReference });

    // Find farmer by virtual account
    const farmer = await prisma.farmer.findFirst({
      where:   { virtualAccountNo: accountNumber },
      include: { user: true },
    });

    if (!farmer) {
      console.log("[Webhook] No farmer found for account:", accountNumber);
      res.json({ received: true, message: "Account not found — ignored" });
      return;
    }

    // Prevent duplicate processing
    const existing = await prisma.transaction.findFirst({
      where: { interswitchRef: transactionReference },
    });
    if (existing) {
      res.json({ received: true, message: "Already processed" });
      return;
    }

    const amountNum  = parseFloat(amount);
    const platformFee = amountNum * 0.01;
    const netAmount  = amountNum - platformFee;

    // Record transaction
    await prisma.transaction.create({
      data: {
        farmerId:       farmer.id,
        type:           "PAYMENT_RECEIVED",
        amount:         amountNum,
        platformFee,
        netAmount,
        description:    `Payment from ${senderName || "Buyer"} via virtual account`,
        interswitchRef: transactionReference,
        status:         "SUCCESS",
      },
    });

    // Update wallet
    await prisma.farmer.update({
      where: { id: farmer.id },
      data: {
        walletBalance: { increment: netAmount },
        totalEarned:   { increment: amountNum },
      },
    });

    console.log(`[Webhook] ✅ Processed ₦${amountNum} for farmer: ${farmer.user.name}`);
    res.json({ received: true });
  } catch (err) {
    console.error("[Webhook] Error:", err);
    next(err);
  }
});

export default router;
