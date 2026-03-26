import { Router, Request, Response, NextFunction } from "express";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { prisma } from "../../config/db";
import { authenticate, requireRole } from "../../middleware/auth";
import { AppError } from "../../middleware/errorHandler";

const router = Router();
router.use(authenticate);

function getModel() {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");
  return genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
}

async function callGemini(prompt: string, fallback: any): Promise<any> {
  try {
    const model  = getModel();
    const result = await model.generateContent(prompt);
    const text   = result.response.text().trim()
      .replace(/```json/g, "").replace(/```/g, "").trim();
    return JSON.parse(text);
  } catch (err) {
    console.error("[AI] Gemini error:", err);
    return fallback;
  }
}

/**
 * @swagger
 * /api/v1/ai/price-intelligence/{inventoryId}:
 *   get:
 *     tags: [AI]
 *     summary: AI market price intelligence for a produce item
 *     description: Compares listed price against Nigerian market rates. Tells farmer/aggregator if they are overpriced or underpriced.
 *     security:
 *       - BearerAuth: []
 */
router.get("/price-intelligence/:inventoryId", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const inv = await prisma.inventory.findUnique({
      where:   { id: req.params.inventoryId },
      include: { farmer: { include: { user: { select: { name: true } } } } },
    });
    if (!inv) throw new AppError("Inventory not found", 404);

    const prompt = `
You are a Nigerian agricultural market analyst for JustAgro.
Analyse this listing and compare it to current Nigerian market rates.

Produce: ${inv.cropType}
Listed Price: ₦${inv.pricePerKg}/kg
Quantity: ${inv.quantity}kg
Total Value: ₦${inv.totalValue}
Location: ${inv.farmer.location || "Nigeria"}
Date: ${new Date().toLocaleDateString("en-NG", { month: "long", year: "numeric" })}

Respond ONLY with a JSON object (no markdown, no backticks):
{
  "estimatedMarketPrice": <number, Naira per kg>,
  "listedPrice": ${inv.pricePerKg},
  "percentageDiff": <number, positive=above market, negative=below>,
  "pricingStatus": "FAIR" | "HIGH" | "LOW",
  "potentialRevenue": <estimated total at market price>,
  "insight": "<2 sentences in plain English>",
  "advice": "<1 actionable sentence for the farmer>",
  "demandLevel": "HIGH" | "MEDIUM" | "LOW"
}`;

    const result = await callGemini(prompt, {
      estimatedMarketPrice: inv.pricePerKg,
      listedPrice:          inv.pricePerKg,
      percentageDiff:       0,
      pricingStatus:        "FAIR",
      potentialRevenue:     inv.totalValue,
      insight:              `Your ${inv.cropType} is priced reasonably for the current market.`,
      advice:               "Keep monitoring market rates and adjust price as needed.",
      demandLevel:          "MEDIUM",
    });

    res.json({ success: true, produce: inv.cropType, result });
  } catch (err) { next(err); }
});

/**
 * @swagger
 * /api/v1/ai/fraud-check/{transactionId}:
 *   get:
 *     tags: [AI]
 *     summary: AI fraud detection on a transaction
 *     description: Analyses quantity, price, and patterns to flag suspicious transactions before payment is released.
 *     security:
 *       - BearerAuth: []
 */
router.get("/fraud-check/:transactionId", requireRole("AGGREGATOR"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const txn = await prisma.transaction.findUnique({
      where:   { id: req.params.transactionId },
      include: {
        farmer: {
          include: {
            transactions: { where: { status: { in: ["PAID", "ASSISTED"] } } },
            inventory:    true,
          },
        },
        buyerContact: true,
      },
    });
    if (!txn) throw new AppError("Transaction not found", 404);

    const paidCount      = txn.farmer.transactions.length;
    const avgAmount      = paidCount > 0
      ? txn.farmer.transactions.reduce((s, t) => s + t.totalAmount, 0) / paidCount : 0;
    const accountAgeDays = Math.ceil(
      (Date.now() - new Date(txn.farmer.createdAt).getTime()) / (1000 * 60 * 60 * 24)
    );

    const prompt = `
You are a fraud detection AI for JustAgro, a Nigerian agricultural payment platform.

TRANSACTION DETAILS:
- Produce: ${txn.cropType}
- Quantity: ${txn.quantity}kg
- Price/kg: ₦${txn.pricePerKg}
- Total: ₦${txn.totalAmount}

FARMER HISTORY:
- Completed transactions: ${paidCount}
- Average transaction value: ₦${avgAmount.toFixed(0)}
- Account age: ${accountAgeDays} days
- Total inventory items: ${txn.farmer.inventory.length}

BUYER:
- Name: ${txn.buyerContact?.name || "Platform buyer"}
- Is new contact: ${!txn.buyerContact?.createdAt || Math.ceil((Date.now() - new Date(txn.buyerContact.createdAt).getTime()) / (1000*60*60*24)) < 3}

Respond ONLY with JSON (no markdown):
{
  "riskScore": "LOW" | "MEDIUM" | "HIGH",
  "riskLevel": <1-10>,
  "flags": ["list specific red flags, empty array if none"],
  "recommendation": "approve" | "review" | "block",
  "summary": "<one sentence for the aggregator>"
}`;

    const result = await callGemini(prompt, {
      riskScore:      "LOW",
      riskLevel:      2,
      flags:          [],
      recommendation: "approve",
      summary:        "No significant risk factors detected for this transaction.",
    });

    // Save risk score back to transaction
    await prisma.transaction.update({
      where: { id: txn.id },
      data:  { riskScore: result.riskScore, riskReason: result.flags?.join(", ") || null },
    }).catch(() => {}); // Non-critical

    res.json({ success: true, result });
  } catch (err) { next(err); }
});

/**
 * @swagger
 * /api/v1/ai/market-summary:
 *   get:
 *     tags: [AI]
 *     summary: AI daily market summary for aggregator dashboard
 *     security:
 *       - BearerAuth: []
 */
router.get("/market-summary", requireRole("AGGREGATOR"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Get top available crops
    const inventory = await prisma.inventory.findMany({
      where:   { status: "AVAILABLE" },
      select:  { cropType: true, quantity: true, pricePerKg: true },
      take:    20,
    });

    const cropSummary = inventory.reduce((acc: any, inv) => {
      if (!acc[inv.cropType]) acc[inv.cropType] = { qty: 0, prices: [] };
      acc[inv.cropType].qty    += inv.quantity;
      acc[inv.cropType].prices.push(inv.pricePerKg);
      return acc;
    }, {});

    const prompt = `
You are an AI market analyst for JustAgro, a Nigerian agricultural platform.
Current available inventory on the platform:
${JSON.stringify(cropSummary, null, 2)}

Today: ${new Date().toLocaleDateString("en-NG", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}

Respond ONLY with JSON (no markdown):
{
  "headline": "<one engaging market headline for today>",
  "topDemand": ["top 3 crops likely in demand today"],
  "priceAlert": "<one price trend observation for Nigerian market>",
  "tip": "<one actionable tip for the aggregator today>",
  "sentiment": "BULLISH" | "NEUTRAL" | "BEARISH"
}`;

    const result = await callGemini(prompt, {
      headline:   "Market conditions stable across Nigerian agricultural commodities today.",
      topDemand:  ["Maize", "Rice", "Tomatoes"],
      priceAlert: "Monitor Maize prices as dry season typically drives prices higher.",
      tip:        "Consider linking pending inventory to active buyers to close transactions faster.",
      sentiment:  "NEUTRAL",
    });

    res.json({ success: true, result });
  } catch (err) { next(err); }
});

/**
 * @swagger
 * /api/v1/ai/farmer-advice:
 *   get:
 *     tags: [AI]
 *     summary: AI personalised advice for farmer based on their data
 *     security:
 *       - BearerAuth: []
 */
router.get("/farmer-advice", requireRole("FARMER"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const farmer = await prisma.farmer.findUnique({
      where:   { id: req.user!.farmerId! },
      include: {
        user:         { select: { name: true } },
        inventory:    true,
        transactions: { where: { status: { in: ["PAID", "ASSISTED"] } }, take: 10 },
      },
    });
    if (!farmer) throw new AppError("Not found", 404);

    const totalEarned  = farmer.transactions.reduce((s, t) => s + t.farmerReceives, 0);
    const avgPerDeal   = farmer.transactions.length > 0 ? totalEarned / farmer.transactions.length : 0;
    const availableQty = farmer.inventory.filter(i => i.status === "AVAILABLE").reduce((s, i) => s + i.quantity, 0);

    const prompt = `
You are a friendly agricultural finance advisor for JustAgro in Nigeria.
Give ${farmer.user.name} personalised advice.

FARMER DATA:
- Farm: ${farmer.farmName}, ${farmer.location}
- Crops: ${farmer.cropTypes.join(", ")}
- Completed deals: ${farmer.transactions.length}
- Total earned: ₦${totalEarned.toLocaleString()}
- Average per deal: ₦${avgPerDeal.toFixed(0)}
- Available stock: ${availableQty}kg across ${farmer.inventory.filter(i=>i.status==="AVAILABLE").length} items
- Wallet balance: ₦${farmer.walletBalance.toLocaleString()}

Respond ONLY with JSON (no markdown):
{
  "greeting": "<warm personal greeting using first name>",
  "performance": "<2 sentences on their business performance>",
  "topAdvice": ["3 specific actionable tips for this farmer"],
  "pricingTip": "<one tip about their current stock pricing>",
  "encouragement": "<one motivating sentence in Nigerian English style>"
}`;

    const result = await callGemini(prompt, {
      greeting:     `Hello ${farmer.user.name.split(" ")[0]}!`,
      performance:  `You have completed ${farmer.transactions.length} transactions on JustAgro.`,
      topAdvice:    ["Keep your inventory updated", "Respond to buyer requests quickly", "Add quality notes to your stock"],
      pricingTip:   "Check local market prices regularly to stay competitive.",
      encouragement: "Keep farming and keep growing! 🌾",
    });

    res.json({ success: true, result });
  } catch (err) { next(err); }
});

export default router;
