import { prisma } from "../../config/db";
import { AppError } from "../../middleware/errorHandler";
import { initiatePayment as interswitchPay, verifyPayment as interswitchVerify } from "../../lib/interswitch";
import { calculateCreditScore } from "../../lib/creditScore";
import { generateReceiptCode, createReceipt, buildWhatsAppShareUrl } from "../../lib/receipt";
import {
  notifyFarmerPaymentReceived,
  notifyBuyerPaymentSuccess,
  notifyAggregatorPayment,
} from "../../lib/notifications";

// List deliveries (role-aware) 
export async function listDeliveries(
  userId:      string,
  role:        string,
  farmerId?:   string,
  buyerId?:    string,
  aggregatorId?: string,
  tab?:        string,
  status?:     string
) {
  const statusFilter = tab === "history"
    ? { status: { in: ["PAID", "CANCELLED", "DISPUTED"] as any } }
    : tab === "pending"
    ? { status: "PENDING" as any }
    : status
    ? { status: status as any }
    : {};

  if (role === "BUYER") {
    return prisma.delivery.findMany({
      where:   { buyerId: buyerId!, ...statusFilter },
      include: {
        farmer:  { include: { user: { select: { name: true, phone: true } } } },
        receipt: true,
      },
      orderBy: { createdAt: "desc" },
    });
  }

  if (role === "FARMER") {
    return prisma.delivery.findMany({
      where:   { farmerId: farmerId!, ...statusFilter },
      include: {
        buyer:   { include: { user: { select: { name: true, phone: true } } } },
        receipt: true,
      },
      orderBy: { createdAt: "desc" },
    });
  }

  if (role === "AGGREGATOR") {
    return prisma.delivery.findMany({
      where:   { aggregatorId: aggregatorId!, ...statusFilter },
      include: {
        farmer:  { include: { user: { select: { name: true } } } },
        buyer:   { include: { user: { select: { name: true } } } },
        receipt: true,
      },
      orderBy: { createdAt: "desc" },
    });
  }

  return [];
}

// Get single delivery
export async function getDeliveryById(id: string) {
  const delivery = await prisma.delivery.findUnique({
    where:   { id },
    include: {
      farmer:     { include: { user: { select: { name: true, phone: true } } } },
      buyer:      { include: { user: { select: { name: true, phone: true } } } },
      aggregator: { include: { user: { select: { name: true } } } },
      receipt:    true,
    },
  });
  if (!delivery) throw new AppError("Delivery not found", 404);
  return delivery;
}

// Create delivery 
export async function createDelivery(data: {
  farmerId:     string;
  buyerId:      string;
  productName:  string;
  quantity:     number;
  pricePerKg:   number;
  aggregatorId?: string;
}) {
  const totalAmount = data.quantity * data.pricePerKg;

  // Generate receipt code at creation time (before payment)
  const count = await prisma.delivery.count();
  const date  = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const receiptCode = `AGT-${date}-${String(count + 1).padStart(4, "0")}`;

  return prisma.delivery.create({
    data: {
      farmerId:     data.farmerId,
      buyerId:      data.buyerId,
      aggregatorId: data.aggregatorId,
      productName:  data.productName,
      quantity:     data.quantity,
      pricePerKg:   data.pricePerKg,
      totalAmount,
      receiptCode,
      status: "PENDING",
    },
    include: {
      farmer: { include: { user: { select: { name: true } } } },
      buyer:  { include: { user: { select: { name: true } } } },
    },
  });
}

// Initiate payment 
export async function startPayment(deliveryId: string, buyerId: string) {
  const delivery = await prisma.delivery.findUnique({
    where:   { id: deliveryId },
    include: {
      farmer: { include: { user: true } },
      buyer:  { include: { user: true } },
    },
  });

  if (!delivery)                    throw new AppError("Delivery not found", 404);
  if (delivery.buyerId !== buyerId) throw new AppError("Forbidden", 403);
  if (delivery.status !== "PENDING") throw new AppError(`Delivery is already ${delivery.status}`, 400);

  const appUrl = process.env.FRONTEND_URL || "http://localhost:3000";

  return interswitchPay({
    deliveryId:  delivery.id,
    buyerPhone:  delivery.buyer.user.phone,
    buyerEmail:  delivery.buyer.user.email || `${delivery.buyer.user.phone}@justagro.com`,
    buyerName:   delivery.buyer.user.name,
    amount:      delivery.totalAmount,
    description: `Payment for ${delivery.productName} (${delivery.quantity}kg) — ${delivery.receiptCode}`,
    callbackUrl: `${appUrl}/payment/callback?deliveryId=${delivery.id}`,
  });
}

// Verify & confirm payment 
export async function confirmPayment(
  deliveryId:    string,
  reference:     string,
  paymentMethod: string = "CARD"
) {
  // Fetch full delivery with all relations
  const delivery = await prisma.delivery.findUnique({
    where:   { id: deliveryId },
    include: {
      farmer: {
        include: {
          user:         true,
          transactions: true,
          loans:        { where: { status: { in: ["DISBURSED", "REPAYING"] } } },
        },
      },
      buyer:      { include: { user: true } },
      aggregator: { include: { user: true, commissionRate: false } as any },
    },
  });

  if (!delivery)                     throw new AppError("Delivery not found", 404);
  if (delivery.status === "PAID")    return getReceiptForDelivery(deliveryId); // idempotent
  if (delivery.status !== "PENDING") throw new AppError(`Cannot verify a ${delivery.status} delivery`, 400);

  // Verify with Interswitch
  const verification = await interswitchVerify(reference);
  if (!verification.success) throw new AppError("Payment verification failed — please try again", 400);

  // Calculate fees
  const aggCommission = (delivery.aggregator as any)?.commissionRate ?? 1.0;
  const platformFee   = delivery.totalAmount * (aggCommission / 100);
  const netAmount     = delivery.totalAmount - platformFee;

  // This update delivery to PAID
  await prisma.delivery.update({
    where: { id: delivery.id },
    data: {
      status:         "PAID",
      paidAt:         new Date(),
      interswitchRef: reference,
      paymentMethod,
    },
  });

  // The record transaction
  await prisma.transaction.create({
    data: {
      farmerId:       delivery.farmerId,
      buyerId:        delivery.buyerId,
      deliveryId:     delivery.id,
      type:           "PAYMENT_RECEIVED",
      amount:         delivery.totalAmount,
      platformFee,
      netAmount,
      description:    `Payment for ${delivery.productName} (${delivery.quantity}kg) — ${delivery.receiptCode}`,
      interswitchRef: reference,
    },
  });

  // This update farmer wallet
  await prisma.farmer.update({
    where: { id: delivery.farmerId },
    data: {
      walletBalance: { increment: netAmount },
      totalEarned:   { increment: delivery.totalAmount },
    },
  });

  // Auto loan repayment (15% of net payment)
  const activeLoan = delivery.farmer.loans[0];
  if (activeLoan) {
    const repayAmt  = Math.min(netAmount * 0.15, activeLoan.totalRepayable - activeLoan.amountRepaid);
    const newRepaid = activeLoan.amountRepaid + repayAmt;

    await prisma.loan.update({
      where: { id: activeLoan.id },
      data: {
        amountRepaid: newRepaid,
        status: newRepaid >= activeLoan.totalRepayable ? "COMPLETED" : "REPAYING",
      },
    });

    await prisma.transaction.create({
      data: {
        farmerId:    delivery.farmerId,
        type:        "LOAN_REPAYMENT",
        amount:      repayAmt,
        platformFee: 0,
        netAmount:   repayAmt,
        description: `Auto-repayment (15%) from ${delivery.receiptCode}`,
      },
    });

    await prisma.farmer.update({
      where: { id: delivery.farmerId },
      data:  { walletBalance: { decrement: repayAmt } },
    });
  }

  // Recalculate credit score
  const allTx     = await prisma.transaction.findMany({ where: { farmerId: delivery.farmerId } });
  const updFarmer = await prisma.farmer.findUnique({ where: { id: delivery.farmerId } });
  const scoreData = calculateCreditScore(allTx, updFarmer!);
  await prisma.farmer.update({ where: { id: delivery.farmerId }, data: { creditScore: scoreData.score } });

  // Create digital receipt
  const receipt = await createReceipt({
    receiptCode:   delivery.receiptCode!,
    deliveryId:    delivery.id,
    farmerName:    delivery.farmer.user.name,
    buyerName:     delivery.buyer.user.name,
    productName:   delivery.productName,
    quantity:      delivery.quantity,
    amount:        delivery.totalAmount,
    paymentMethod,
    paidAt:        new Date(),
  });

  // 7. it will push all notifications
  Promise.allSettled([
    notifyFarmerPaymentReceived({
      farmerPhone:  delivery.farmer.user.phone,
      farmerName:   delivery.farmer.user.name,
      farmerUserId: delivery.farmer.userId,
      buyerName:    delivery.buyer.user.name,
      productName:  delivery.productName,
      quantity:     delivery.quantity,
      amount:       delivery.totalAmount,
      receiptCode:  delivery.receiptCode!,
      deliveryId:   delivery.id,
      newScore:     scoreData.score,
    }),
    notifyBuyerPaymentSuccess({
      buyerPhone:  delivery.buyer.user.phone,
      buyerName:   delivery.buyer.user.name,
      buyerUserId: delivery.buyer.userId,
      farmerName:  delivery.farmer.user.name,
      productName: delivery.productName,
      amount:      delivery.totalAmount,
      receiptCode: delivery.receiptCode!,
      deliveryId:  delivery.id,
    }),
    delivery.aggregator
      ? notifyAggregatorPayment({
          aggregatorPhone:  (delivery.aggregator as any).user.phone,
          aggregatorUserId: (delivery.aggregator as any).userId,
          farmerName:       delivery.farmer.user.name,
          buyerName:        delivery.buyer.user.name,
          productName:      delivery.productName,
          amount:           delivery.totalAmount,
          platformFee,
          receiptCode:      delivery.receiptCode!,
          deliveryId:       delivery.id,
        })
      : Promise.resolve(),
  ]).catch(console.error);

  const whatsappUrl = buildWhatsAppShareUrl({ ...receipt });

  return {
    receipt: { ...receipt, whatsappUrl },
    newScore: scoreData.score,
    message: "Payment confirmed! Receipt generated and sent.",
  };
}

// Get receipt for a delivery
async function getReceiptForDelivery(deliveryId: string) {
  const receipt = await prisma.receipt.findUnique({ where: { deliveryId } });
  if (!receipt) throw new AppError("Receipt not found", 404);
  const whatsappUrl = buildWhatsAppShareUrl({ ...receipt });
  return { receipt: { ...receipt, whatsappUrl }, newScore: 0, message: "Already paid" };
}
