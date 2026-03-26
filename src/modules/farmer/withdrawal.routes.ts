import { Router, Request, Response, NextFunction } from "express";
import axios from "axios";
import { prisma } from "../../config/db";
import { authenticate, requireRole } from "../../middleware/auth";
import { AppError } from "../../middleware/errorHandler";
import { notifyWithdrawal } from "../../lib/notifications";

const router = Router();
router.use(authenticate, requireRole("FARMER"));

const ISW_BASE = process.env.INTERSWITCH_BASE_URL || "https://qa.interswitchng.com";
 
async function getToken(): Promise<string | null> {
  const id     = process.env.INTERSWITCH_CLIENT_ID;
  const secret = process.env.INTERSWITCH_CLIENT_SECRET;
  if (!id || !secret) return null;

  try {
    const res = await axios.post(
      `${ISW_BASE}/passport/oauth/token`,
      "grant_type=client_credentials",
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
        },
        timeout: 10_000,
      }
    );
    return res.data.access_token || null;
  } catch (err: any) {
    console.warn("[ISW Token]", err.response?.data?.error || err.message);
    return null;
  }
}

/**
 * @swagger
 * /api/v1/farmer/banks:
 *   get:
 *     tags: [Farmer]
 *     summary: Get Nigerian bank list
 *     security:
 *       - BearerAuth: []
 */
router.get("/banks", async (_req: Request, res: Response) => {
  // Comprehensive static list — all major Nigerian banks
  // Using Interswitch bank codes (3-letter) as per Payout API docs
  const banks = [
    { code: "ABP", name: "Access Bank",                    cbnCode: "044" },
    { code: "ZIB", name: "Zenith Bank",                    cbnCode: "057" },
    { code: "GTB", name: "Guaranty Trust Bank (GTBank)",   cbnCode: "058" },
    { code: "UBA", name: "United Bank for Africa (UBA)",   cbnCode: "033" },
    { code: "FBN", name: "First Bank of Nigeria",          cbnCode: "011" },
    { code: "FCM", name: "First City Monument Bank (FCMB)",cbnCode: "214" },
    { code: "FBP", name: "Fidelity Bank",                  cbnCode: "070" },
    { code: "SBP", name: "Sterling Bank",                  cbnCode: "232" },
    { code: "UBN", name: "Union Bank of Nigeria",          cbnCode: "032" },
    { code: "UBP", name: "Unity Bank",                     cbnCode: "215" },
    { code: "WMA", name: "Wema Bank / ALAT",               cbnCode: "035" },
    { code: "ECO", name: "EcoBank Nigeria",                cbnCode: "050" },
    { code: "IBT", name: "Stanbic IBTC Bank",              cbnCode: "221" },
    { code: "SKY", name: "Polaris Bank",                   cbnCode: "076" },
    { code: "KSB", name: "Keystone Bank",                  cbnCode: "082" },
    { code: "TAJ", name: "TAJ Bank",                       cbnCode: "302" },
    { code: "TTB", name: "Titan Trust Bank",               cbnCode: "102" },
    { code: "JAI", name: "Jaiz Bank",                      cbnCode: "301" },
    { code: "LTB", name: "Lotus Bank",                     cbnCode: "303" },
    { code: "GLB", name: "Globus Bank",                    cbnCode: "103" },
    { code: "PMB", name: "Parallex Bank",                  cbnCode: "104" },
    { code: "UMB", name: "Providus Bank",                  cbnCode: "101" },
    { code: "PRM", name: "Premium Trust Bank",             cbnCode: "105" },
    { code: "CTB", name: "Citibank Nigeria",               cbnCode: "023" },
    { code: "SCH", name: "Standard Chartered Bank",        cbnCode: "068" },
    { code: "MNP", name: "Moniepoint MFB",                 cbnCode: "425" },
    { code: "OPY", name: "OPay",                           cbnCode: "131" },
    { code: "PLM", name: "PalmPay",                        cbnCode: "999" },
    { code: "KDB", name: "Kuda MFB",                       cbnCode: "KDB" },
    { code: "VDM", name: "VFD MFB",                        cbnCode: "354" },
    { code: "SHB", name: "Safe Haven MFB",                 cbnCode: "403" },
    { code: "FFB", name: "FairMoney MFB",                  cbnCode: "495" },
    { code: "SPK", name: "Sparkle MFB",                    cbnCode: "SPK" },
    { code: "HPB", name: "HopePSB",                        cbnCode: "800" },
    { code: "MPB", name: "MoMo PSB (MTN)",                 cbnCode: "120" },
    { code: "SCP", name: "SmartCash PSB (Airtel)",         cbnCode: "121" },
    { code: "TRP", name: "TEST BANK (Sandbox only)",       cbnCode: "TRP" },
  ].sort((a, b) => a.name.localeCompare(b.name));

  res.json({ success: true, data: banks });
});

/**
 * @swagger
 * /api/v1/farmer/withdraw:
 *   post:
 *     tags: [Farmer]
 *     summary: Withdraw wallet balance to bank account
 *     description: |
 *       Uses Interswitch Payouts API (BANK_TRANSFER).
 *       **Sandbox test:** use recipientAccount=0037320662 and recipientBank=TRP for guaranteed success.
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [amount, recipientAccount, recipientBank, accountName]
 *             properties:
 *               amount:           { type: number, example: 5000 }
 *               recipientAccount: { type: string, example: "0037320662" }
 *               recipientBank:    { type: string, example: "TRP" }
 *               accountName:      { type: string, example: "EMEKA OKAFOR" }
 */
router.post("/withdraw", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { amount, recipientAccount, recipientBank, accountName } = req.body;

    if (!amount || !recipientAccount || !recipientBank || !accountName) {
      throw new AppError("amount, recipientAccount, recipientBank, accountName required", 400);
    }

    const amtNum  = parseFloat(amount);
    const accNum  = recipientAccount.toString().replace(/\D/g, "");

    if (isNaN(amtNum) || amtNum <= 0) throw new AppError("Amount must be > 0", 400);
    if (amtNum < 100)                 throw new AppError("Minimum withdrawal: ₦100", 400);
    if (accNum.length !== 10)         throw new AppError("Account number must be 10 digits", 400);

    const farmer = await prisma.farmer.findUnique({
      where:   { id: req.user!.farmerId! },
      include: { user: true },
    });
    if (!farmer) throw new AppError("Farmer not found", 404);

    if (farmer.walletBalance < amtNum) {
      throw new AppError(`Insufficient balance. Available: ₦${farmer.walletBalance.toLocaleString()}`, 400);
    }

    const txRef    = `WDL_${Date.now()}_${Math.floor(1000 + Math.random() * 9000)}`;
    const walletId = process.env.INTERSWITCH_WALLET_ID || "";
    const walletPin= process.env.INTERSWITCH_WALLET_PIN || "";

    let status    = "PROCESSING";
    let reference = txRef;
    let usedReal  = false;

    // Interswitch Payouts API 
    const token = await getToken();

    if (token && walletId && walletPin) {
      try {
        const body = {
          transactionReference: txRef,
          payoutChannel:        "BANK_TRANSFER",
          currencyCode:         "NGN",
          amount:               amtNum,          // major denomination (Naira)
          narration:            `JustAgro withdrawal - ${farmer.user.name}`,
          sourceAccountName:    "JustAgro Platform",
          walletDetails: {
            pin:      walletPin,
            walletId: walletId,
          },
          recipient: {
            recipientAccount: accNum,
            recipientBank:    recipientBank,
            currencyCode:     "NGN",
            amount:           amtNum,            // required per docs
          },
          singleCall: true,
        };

        console.log("[Payout] Calling Interswitch:", { txRef, amount: amtNum, bank: recipientBank, account: accNum });

        const resp = await axios.post(
          `${ISW_BASE}/api/v1/payouts`,
          body,
          {
            headers: {
              Authorization:  `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            timeout: 30_000,
          }
        );

        const d = resp.data;
        console.log("[Payout] Response:", d);

        if (d.status?.toUpperCase() === "FAILED") {
          throw new AppError(d.responseDescription || "Payout failed", 400);
        }

        status    = d.status || "PROCESSING";
        reference = d.transactionReference || txRef;
        usedReal  = true;

      } catch (err: any) {
        if (err instanceof AppError) throw err;
        console.error("[Payout] Error:", err.response?.data || err.message);

        // If no network response (timeout, CORS, etc) - sandbox fallback
        if (!err.response) {
          console.warn("[Payout] Network issue — sandbox simulation");
          status   = "PROCESSING";
          usedReal = false;
        } else {
          const msg = err.response.data?.description
                   || err.response.data?.message
                   || err.response.data?.responseDescription
                   || "Interswitch payout failed";
          throw new AppError(msg, 400);
        }
      }
    } else {
      console.warn("[Payout] No credentials or wallet configured — sandbox simulation");
      status   = "PROCESSING";
      usedReal = false;
    }

    // Deduct wallet 
    const updated = await prisma.farmer.update({
      where: { id: farmer.id },
      data:  { walletBalance: { decrement: amtNum } },
    });

    await notifyWithdrawal({
      farmerPhone:  farmer.user.phone,
      farmerName:   farmer.user.name,
      farmerUserId: farmer.userId,
      amount:       amtNum,
      reference,
    });

    console.log(`[Payout] ₦${amtNum} withdrawn — ${farmer.user.name} → ${recipientBank}:${accNum}`);

    res.json({
      success:          true,
      transactionReference: reference,
      status,
      amountWithdrawn:  amtNum,
      recipientAccount: accNum,
      recipientBank,
      accountName,
      newBalance:       updated.walletBalance,
      usedRealApi:      usedReal,
      message: status === "SUCCESSFUL"
        ? `₦${amtNum.toLocaleString()} sent successfully to ${accountName}`
        : `₦${amtNum.toLocaleString()} transfer is processing. Arrives in 1–24 hours.`,
      note: !walletId
        ? "Configure INTERSWITCH_WALLET_ID and INTERSWITCH_WALLET_PIN in .env for live transfers"
        : undefined,
    });

  } catch (err) { next(err); }
});

/**
 * @swagger
 * /api/v1/farmer/withdraw/{reference}:
 *   get:
 *     tags: [Farmer]
 *     summary: Check withdrawal status
 *     security:
 *       - BearerAuth: []
 */
router.get("/withdraw/:reference", async (req: Request, res: Response) => {
  const token = await getToken().catch(() => null);

  if (!token) {
    return res.json({ success: true, status: "PROCESSING", message: "Sandbox mode" });
  }

  try {
    const r = await axios.get(
      `${ISW_BASE}/api/v1/payouts/${req.params.reference}`,
      {
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        timeout: 10_000,
      }
    );
    const d = r.data;
    res.json({
      success: true,
      status:           d.status,
      amount:           d.amount,
      recipientAccount: d.recipientAccount,
      recipientName:    d.recipientName,
      responseCode:     d.responseCode,
      responseDesc:     d.responseDescription,
    });
  } catch {
    res.json({ success: false, status: "UNKNOWN" });
  }
});

export default router;
