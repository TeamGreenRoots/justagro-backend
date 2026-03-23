import { Router } from "express";
import { authenticate, requireRole } from "../../middleware/auth";
import { prisma } from "../../config/db";
import { calculateCreditScore } from "../../lib/creditScore";
import { disburseLoan } from "../../lib/interswitch";
import { notifyFarmerLoanDisbursed } from "../../lib/notifications";

const router = Router();
router.use(authenticate, requireRole("FARMER"));

/**
 * @swagger
 * /api/v1/loans:
 *   get:
 *     tags: [Loans]
 *     summary: Get farmer loan history
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: List of loans
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 loans:   { type: array, items: { $ref: '#/components/schemas/Loan' } }
 */
router.get("/", async (req, res, next) => {
  try {
    const loans = await prisma.loan.findMany({
      where:   { farmerId: req.user!.farmerId! },
      orderBy: { createdAt: "desc" },
    });
    res.json({ success: true, loans });
  } catch (err) { next(err); }
});

/**
 * @swagger
 * /api/v1/loans:
 *   post:
 *     tags: [Loans]
 *     summary: Apply for a microloan
 *     description: |
 *       Loan eligibility is based on credit score:
 *       - Score 40-59 (Starter): up to ₦20,000
 *       - Score 60-79 (Standard): up to ₦100,000
 *       - Score 80-100 (Premium): up to ₦500,000
 *
 *       Repayment: 15% auto-deducted from each incoming payment.
 *       Interest: flat 5%.
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/LoanRequest'
 *           example:
 *             amount: 50000
 *     responses:
 *       200:
 *         description: Loan approved and disbursed via Interswitch
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 loan:    { $ref: '#/components/schemas/Loan' }
 *       400:
 *         description: Not eligible or already has an active loan
 */
router.post("/", async (req, res, next) => {
  try {
    const { amount } = req.body;

    if (!amount || isNaN(amount) || amount <= 0) {
      res.status(400).json({ success: false, error: "Valid amount is required" });
      return;
    }

    const farmer = await prisma.farmer.findUnique({
      where:   { id: req.user!.farmerId! },
      include: { transactions: true, user: true },
    });

    if (!farmer) { res.status(404).json({ success: false, error: "Farmer not found" }); return; }

    // Check eligibility
    const scoreData = calculateCreditScore(farmer.transactions, farmer);
    if (!scoreData.loanEligibility.eligible) {
      res.status(400).json({
        success: false,
        error:   "Not eligible for a loan",
        reason:  scoreData.loanEligibility.reason,
        score:   scoreData.score,
      });
      return;
    }

    if (parseFloat(amount) > scoreData.loanEligibility.maxAmount) {
      res.status(400).json({
        success: false,
        error:   `Maximum eligible loan is ₦${scoreData.loanEligibility.maxAmount.toLocaleString()}`,
      });
      return;
    }

    // Check no active loan
    const activeLoan = await prisma.loan.findFirst({
      where: { farmerId: farmer.id, status: { in: ["APPROVED", "DISBURSED", "REPAYING"] } },
    });
    if (activeLoan) {
      res.status(400).json({ success: false, error: "You already have an active loan. Repay it first." });
      return;
    }

    const loanAmount    = parseFloat(amount);
    const totalRepayable = loanAmount * 1.05;

    const loan = await prisma.loan.create({
      data: {
        farmerId:      farmer.id,
        amount:        loanAmount,
        interestRate:  5.0,
        totalRepayable,
        status:        "APPROVED",
      },
    });

    // Disburse via Interswitch
    const disbursement = await disburseLoan({
      accountNumber: farmer.virtualAccountNo!,
      bankCode:      farmer.bankCode!,
      amount:        loanAmount,
      reference:     loan.id,
      narration:     `JustAgro Loan - ${farmer.user.name}`,
    });

    await prisma.loan.update({
      where: { id: loan.id },
      data: {
        status:      "DISBURSED",
        disbursedAt: new Date(),
        dueDate:     new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
      },
    });

    await prisma.transaction.create({
      data: {
        farmerId:       farmer.id,
        type:           "LOAN_DISBURSEMENT",
        amount:         loanAmount,
        platformFee:    0,
        netAmount:      loanAmount,
        description:    `Loan disbursed — repay ₦${totalRepayable.toLocaleString()} in 90 days`,
        interswitchRef: disbursement.reference,
      },
    });

    await notifyFarmerLoanDisbursed({
      phone:          farmer.user.phone,
      name:           farmer.user.name,
      userId:         farmer.userId,
      amount:         loanAmount,
      totalRepayable,
    });

    res.json({ success: true, loan: await prisma.loan.findUnique({ where: { id: loan.id } }), disbursement });
  } catch (err) { next(err); }
});

export default router;
