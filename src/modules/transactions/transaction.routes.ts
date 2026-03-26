import { Router, Request, Response, NextFunction } from "express";
import { prisma } from "../../config/db";
import { authenticate, requireRole } from "../../middleware/auth";
import { AppError } from "../../middleware/errorHandler";
import {
  generateTxnRef,
  getPaymentConfig,
  getCheckoutScriptUrl,
  verifyTransaction,
} from "../../lib/interswitch";
import {
  notifyBuyerPaymentLink,
  notifyFarmerPayment,
  notifyAggregatorPayment,
} from "../../lib/notifications";

const router = Router();

/**
 * @swagger
 * /api/v1/transactions/public/{txnRef}:
 *   get:
 *     tags: [Public]
 *     summary: Get transaction for payment page (no auth)
 *     security: []
 */
router.get("/public/:txnRef", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const txn = await prisma.transaction.findUnique({
      where: { txnRef: req.params.txnRef },
      include: {
        farmer:       { include: { user: true } },
        buyerContact: true,
        buyer:        { include: { user: { select: { name: true, email: true, phone: true } } } },
        receipt:      true,
      },
    });

    if (!txn) throw new AppError("Transaction not found", 404);

    if (txn.status === "PAID" || txn.status === "ASSISTED") {
      return res.json({ success: true, status: txn.status, alreadyPaid: true, txnRef: txn.txnRef, receipt: txn.receipt });
    }
    if (txn.status === "CANCELLED") {
      return res.json({ success: false, status: "CANCELLED", message: "This transaction was cancelled" });
    }

    const buyerName  = txn.buyerContact?.name  || txn.buyer?.user?.name  || "Buyer";
    const buyerEmail = txn.buyerContact?.email || txn.buyer?.user?.email || "buyer@justagro.com";
    const buyerPhone = txn.buyerContact?.phone || txn.buyer?.user?.phone || "";

    const paymentConfig = getPaymentConfig({
      txnRef:      txn.txnRef,
      amountNaira: txn.totalAmount,
      custEmail:   buyerEmail,
      custName:    buyerName,
      custPhone:   buyerPhone,
      redirectUrl: `${process.env.FRONTEND_URL}/pay/${txn.txnRef}/callback`,
    });

    res.json({
      success: true, status: txn.status, alreadyPaid: false,
      txnRef: txn.txnRef, cropType: txn.cropType, quantity: txn.quantity,
      pricePerKg: txn.pricePerKg, totalAmount: txn.totalAmount,
      farmerName:  txn.farmer.user.name,
      farmName:    txn.farmer.farmName,
      buyerName, createdAt: txn.createdAt,
      paymentConfig, checkoutScriptUrl: getCheckoutScriptUrl(),
    });
  } catch (err) { next(err); }
});

// PUBLIC — VERIFY payment after Interswitch callback
/**
 * @swagger
 * /api/v1/transactions/public/{txnRef}/verify:
 *   post:
 *     tags: [Public]
 *     summary: Verify Interswitch payment (no auth)
 *     security: []
 */
router.post("/public/:txnRef/verify", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const txn = await prisma.transaction.findUnique({
      where:   { txnRef: req.params.txnRef },
      include: {
        farmer:       { include: { user: true } },
        buyerContact: true,
        buyer:        { include: { user: true } },
        aggregator:   { include: { user: true } },
        receipt:      true,
      },
    });

    if (!txn) throw new AppError("Transaction not found", 404);
    if (txn.status === "PAID" || txn.status === "ASSISTED") {
      return res.json({ success: true, alreadyPaid: true, receipt: txn.receipt });
    }
    if (txn.status === "CANCELLED") throw new AppError("Transaction cancelled", 400);

    // Server-side verification with Interswitch
    const expectedKobo  = Math.round(txn.totalAmount * 100);
    const verification  = await verifyTransaction(txn.txnRef, expectedKobo);

    if (!verification.success) {
      return res.status(400).json({
        success: false,
        error:   "Payment not confirmed",
        message: `Code: ${verification.responseCode} — ${verification.responseDesc}`,
      });
    }

    // Mark PAID
    await prisma.transaction.update({
      where: { id: txn.id },
      data: {
        status:         "PAID",
        paymentMethod:  "INTERSWITCH",
        interswitchRef: txn.txnRef,
        interswitchPay: verification.paymentReference,
        paidAt:         new Date(),
      },
    });

    // Mark inventory SOLD
    await prisma.inventory.updateMany({
      where: { transactionId: txn.id },
      data:  { status: "SOLD" },
    });

    // Update farmer wallet
    await prisma.farmer.update({
      where: { id: txn.farmerId },
      data: {
        walletBalance: { increment: txn.farmerReceives },
        totalEarned:   { increment: txn.totalAmount },
      },
    });

    // Create receipt
    const buyerName = txn.buyerContact?.name || txn.buyer?.user?.name || "Buyer";
    const receipt   = await prisma.receipt.create({
      data: {
        transactionId:  txn.id,
        txnRef:         txn.txnRef,
        farmerName:     txn.farmer.user.name,
        farmName:       txn.farmer.farmName,
        buyerName,
        cropType:       txn.cropType,
        quantity:       txn.quantity,
        pricePerKg:     txn.pricePerKg,
        totalAmount:    txn.totalAmount,
        platformFee:    txn.platformFee,
        farmerReceives: txn.farmerReceives,
        paymentMethod:  "INTERSWITCH",
        paidAt:         new Date(),
      },
    });

    // Notifications (non-blocking)
    const buyerPhone = txn.buyerContact?.phone || txn.buyer?.user?.phone || "";
    Promise.allSettled([
      notifyFarmerPayment({
        farmerPhone:    txn.farmer.user.phone,
        farmerName:     txn.farmer.user.name,
        farmerUserId:   txn.farmer.userId,
        buyerName,
        cropType:       txn.cropType,
        quantity:       txn.quantity,
        farmerReceives: txn.farmerReceives,
        txnRef:         txn.txnRef,
        transactionId:  txn.id,
      }),
      notifyAggregatorPayment({
        aggregatorUserId: txn.aggregator.userId,
        farmerName:       txn.farmer.user.name,
        buyerName,
        cropType:         txn.cropType,
        totalAmount:      txn.totalAmount,
        platformFee:      txn.platformFee,
        txnRef:           txn.txnRef,
        transactionId:    txn.id,
      }),
    ]);

    res.json({ success: true, status: "PAID", receipt });
  } catch (err) { next(err); }
});

// INTERSWITCH WEBHOOK — Interswitch calls this automatically
/**
 * @swagger
 * /api/v1/transactions/webhook:
 *   post:
 *     tags: [Public]
 *     summary: Interswitch payment webhook (auto-called by Interswitch)
 *     security: []
 */
router.post("/webhook", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { txnref, amount, ResponseCode, ResponseDescription, paymentReference } = req.body;
    console.log("[Webhook] Interswitch payment notification:", req.body);

    if (!txnref) return res.json({ received: true });

    // Find transaction
    const txn = await prisma.transaction.findUnique({
      where:   { txnRef: txnref },
      include: {
        farmer:       { include: { user: true } },
        buyerContact: true,
        buyer:        { include: { user: true } },
        aggregator:   { include: { user: true } },
      },
    });

    if (!txn || txn.status !== "PENDING") {
      return res.json({ received: true, message: "Already processed or not found" });
    }

    if (ResponseCode === "00") {
      // Payment confirmed by Interswitch
      await prisma.transaction.update({
        where: { id: txn.id },
        data: {
          status: "PAID", paymentMethod: "INTERSWITCH",
          interswitchRef: txnref, interswitchPay: paymentReference,
          paidAt: new Date(),
        },
      });

      await prisma.farmer.update({
        where: { id: txn.farmerId },
        data: { walletBalance: { increment: txn.farmerReceives }, totalEarned: { increment: txn.totalAmount } },
      });

      const buyerName = txn.buyerContact?.name || txn.buyer?.user?.name || "Buyer";
      await prisma.receipt.create({
        data: {
          transactionId: txn.id, txnRef: txn.txnRef,
          farmerName: txn.farmer.user.name, farmName: txn.farmer.farmName,
          buyerName, cropType: txn.cropType, quantity: txn.quantity,
          pricePerKg: txn.pricePerKg, totalAmount: txn.totalAmount,
          platformFee: txn.platformFee, farmerReceives: txn.farmerReceives,
          paymentMethod: "INTERSWITCH", paidAt: new Date(),
        },
      });

      notifyFarmerPayment({
        farmerPhone: txn.farmer.user.phone, farmerName: txn.farmer.user.name,
        farmerUserId: txn.farmer.userId, buyerName,
        cropType: txn.cropType, quantity: txn.quantity,
        farmerReceives: txn.farmerReceives, txnRef: txn.txnRef, transactionId: txn.id,
      });
    }

    res.json({ received: true });
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────────────────────
// ASSISTED — Aggregator marks paid manually (cash/offline)
// ─────────────────────────────────────────────────────────────
/**
 * @swagger
 * /api/v1/transactions/{id}/assist:
 *   post:
 *     tags: [Transactions]
 *     summary: Mark as paid (assisted/cash) — aggregator only
 *     security:
 *       - BearerAuth: []
 */
router.post("/:id/assist", authenticate, requireRole("AGGREGATOR"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const txn = await prisma.transaction.findUnique({
      where:   { id: req.params.id },
      include: { farmer: { include: { user: true } }, buyerContact: true, buyer: { include: { user: true } } },
    });

    if (!txn) throw new AppError("Not found", 404);
    if (txn.aggregatorId !== req.user!.aggregatorId) throw new AppError("Forbidden", 403);
    if (txn.status !== "PENDING") throw new AppError(`Already ${txn.status}`, 400);

    await prisma.transaction.update({
      where: { id: txn.id },
      data: { status: "ASSISTED", paymentMethod: "ASSISTED", paidAt: new Date(), notes: req.body.notes || "Confirmed by aggregator" },
    });

    await prisma.inventory.updateMany({ where: { transactionId: txn.id }, data: { status: "SOLD" } });
    await prisma.farmer.update({
      where: { id: txn.farmerId },
      data: { walletBalance: { increment: txn.farmerReceives }, totalEarned: { increment: txn.totalAmount } },
    });

    const buyerName = txn.buyerContact?.name || txn.buyer?.user?.name || "Buyer";
    const receipt   = await prisma.receipt.create({
      data: {
        transactionId: txn.id, txnRef: txn.txnRef,
        farmerName: txn.farmer.user.name, farmName: txn.farmer.farmName,
        buyerName, cropType: txn.cropType, quantity: txn.quantity,
        pricePerKg: txn.pricePerKg, totalAmount: txn.totalAmount,
        platformFee: txn.platformFee, farmerReceives: txn.farmerReceives,
        paymentMethod: "ASSISTED", paidAt: new Date(),
      },
    });

    notifyFarmerPayment({
      farmerPhone: txn.farmer.user.phone, farmerName: txn.farmer.user.name,
      farmerUserId: txn.farmer.userId, buyerName,
      cropType: txn.cropType, quantity: txn.quantity,
      farmerReceives: txn.farmerReceives, txnRef: txn.txnRef, transactionId: txn.id,
    });

    res.json({ success: true, status: "ASSISTED", receipt });
  } catch (err) { next(err); }
});

/**
 * @swagger
 * /api/v1/transactions:
 *   get:
 *     tags: [Transactions]
 *     summary: List transactions (role-filtered, paginated)
 *     security:
 *       - BearerAuth: []
 */
router.get("/", authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page   = Math.max(1, parseInt(req.query.page  as string) || 1);
    const limit  = Math.min(50, parseInt(req.query.limit as string) || 10);
    const skip   = (page - 1) * limit;
    const status = req.query.status as string | undefined;

    let where: any = {};

    if (req.user!.role === "FARMER") {
      where.farmerId = req.user!.farmerId;
    } else if (req.user!.role === "BUYER") {
    
      const user = await prisma.user.findUnique({
        where: { id: req.user!.userId },
        select: { phone: true },
      });
      where.OR = [
        { buyerId: req.user!.buyerId },
        { buyerContact: { phone: user?.phone } },
      ];
    } else if (req.user!.role === "AGGREGATOR") {
      where.aggregatorId = req.user!.aggregatorId;
    }

    if (status) where.status = status;

    const [items, total] = await Promise.all([
      prisma.transaction.findMany({
        where,
        include: {
          farmer:       { include: { user: { select: { name: true } } } },
          buyerContact: true,
          buyer:        { include: { user: { select: { name: true, phone: true } } } },
          receipt:      true,
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.transaction.count({ where }),
    ]);

    res.json({
      success: true, data: items,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err) { next(err); }
});

/**
 * @swagger
 * /api/v1/transactions:
 *   post:
 *     tags: [Transactions]
 *     summary: Create transaction (aggregator only)
 *     security:
 *       - BearerAuth: []
 */
router.post("/", authenticate, requireRole("AGGREGATOR"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { farmerId, inventoryId, cropType, quantity, pricePerKg, buyerContactId, buyerId, notes } = req.body;

    if (!farmerId || !cropType || !quantity || !pricePerKg) {
      throw new AppError("farmerId, cropType, quantity, pricePerKg required", 400);
    }
    if (!buyerContactId && !buyerId) {
      throw new AppError("buyerContactId or buyerId required", 400);
    }

    const qty        = parseFloat(quantity);
    const price      = parseFloat(pricePerKg);
    const total      = qty * price;
    const fee        = total * 0.01;
    const farmerGets = total - fee;

    if (inventoryId) {
      const inv = await prisma.inventory.findUnique({ where: { id: inventoryId } });
      if (!inv)                        throw new AppError("Inventory not found", 404);
      if (inv.status !== "AVAILABLE") throw new AppError("Inventory not available", 400);
      if (inv.farmerId !== farmerId)   throw new AppError("Inventory does not belong to this farmer", 400);
      if (qty > inv.quantity)          throw new AppError(`Only ${inv.quantity}kg available`, 400);
    }

    const txnRef  = generateTxnRef();
    const payLink = `${process.env.FRONTEND_URL}/pay/${txnRef}`;

    const txn = await prisma.transaction.create({
      data: {
        txnRef, aggregatorId: req.user!.aggregatorId!, farmerId,
        buyerContactId: buyerContactId || null,
        buyerId:        buyerId        || null,
        cropType: cropType.trim(), quantity: qty, pricePerKg: price,
        totalAmount: total, platformFee: fee, farmerReceives: farmerGets,
        status: "PENDING", paymentLink: payLink, notes: notes || null,
        ...(inventoryId && { inventory: { connect: [{ id: inventoryId }] } }),
      },
      include: {
        farmer:       { include: { user: true } },
        buyerContact: true,
        buyer:        { include: { user: true } },
      },
    });

    if (inventoryId) {
      await prisma.inventory.update({
        where: { id: inventoryId },
        data:  { status: "RESERVED", transactionId: txn.id },
      });
    }

    // Notify buyer
    const buyerName  = txn.buyerContact?.name  || txn.buyer?.user?.name  || "Buyer";
    const buyerPhone = txn.buyerContact?.phone || txn.buyer?.user?.phone || "";

    if (buyerPhone) {
      await notifyBuyerPaymentLink({
        buyerPhone, buyerName,
        farmerName:  txn.farmer.user.name,
        cropType:    txn.cropType,
        quantity:    txn.quantity,
        totalAmount: txn.totalAmount,
        paymentLink: payLink,
      });
      await prisma.transaction.update({ where: { id: txn.id }, data: { buyerNotified: true } });
    }

    // Also save in-app notification for platform buyer if they exist
    if (txn.buyerContact?.phone) {
      const linkedUser = await prisma.user.findUnique({ where: { phone: txn.buyerContact.phone } });
      if (linkedUser) {
        await prisma.notification.create({
          data: {
            userId:        linkedUser.id,
            transactionId: txn.id,
            channel:       "IN_APP",
            message:       `New payment request: ${txn.cropType} (${txn.quantity}kg) = ₦${txn.totalAmount.toLocaleString()}\n\nClick to pay: ${payLink}`,
            isRead:        false,
          },
        });
      }
    }

    res.status(201).json({
      success: true, data: txn, paymentLink: payLink,
      message: `Transaction created.${buyerPhone ? " Buyer notified via WhatsApp/SMS." : " No buyer phone — copy link manually."}`,
    });
  } catch (err) { next(err); }
});

router.patch("/:id", authenticate, requireRole("AGGREGATOR"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const txn = await prisma.transaction.findUnique({ where: { id: req.params.id } });
    if (!txn || txn.aggregatorId !== req.user!.aggregatorId) throw new AppError("Not found", 404);
    if (txn.status !== "PENDING") throw new AppError("Can only edit PENDING transactions", 400);

    const { cropType, quantity, pricePerKg, notes } = req.body;
    const qty   = quantity   ? parseFloat(quantity)   : txn.quantity;
    const price = pricePerKg ? parseFloat(pricePerKg) : txn.pricePerKg;
    const total = qty * price;

    const updated = await prisma.transaction.update({
      where: { id: txn.id },
      data: {
        cropType: cropType || txn.cropType, quantity: qty, pricePerKg: price,
        totalAmount: total, platformFee: total * 0.01, farmerReceives: total * 0.99,
        notes: notes !== undefined ? notes : txn.notes,
      },
    });
    res.json({ success: true, data: updated });
  } catch (err) { next(err); }
});


router.post("/:id/cancel", authenticate, requireRole("AGGREGATOR"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const txn = await prisma.transaction.findUnique({ where: { id: req.params.id } });
    if (!txn || txn.aggregatorId !== req.user!.aggregatorId) throw new AppError("Not found", 404);
    if (txn.status !== "PENDING") throw new AppError("Can only cancel PENDING transactions", 400);

    await prisma.transaction.update({ where: { id: txn.id }, data: { status: "CANCELLED" } });
    await prisma.inventory.updateMany({
      where: { transactionId: txn.id },
      data:  { status: "AVAILABLE", transactionId: null },
    });
    res.json({ success: true, message: "Cancelled, inventory released" });
  } catch (err) { next(err); }
});

export default router;
