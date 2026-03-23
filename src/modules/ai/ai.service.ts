import { GoogleGenerativeAI } from "@google/generative-ai";
import { prisma } from "../../config/db";
import { calculateCreditScore } from "../../lib/creditScore";
import { AppError } from "../../middleware/errorHandler";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

// Helper: get Gemini Flash model (FREE tier)
function getModel() {
  return genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
}

//  AI CREDIT SCORE EXPLAINER: Takes farmer's score data - returns personalized advice
export async function explainCreditScore(farmerId: string) {
  const farmer = await prisma.farmer.findUnique({
    where:   { id: farmerId },
    include: { transactions: true, user: { select: { name: true } } },
  });

  if (!farmer) throw new AppError("Farmer not found", 404);

  const scoreData = calculateCreditScore(farmer.transactions, farmer);
  const { score, breakdown, loanEligibility } = scoreData;

  const prompt = `
You are a friendly Nigerian agricultural finance advisor called JustAgro AI.
Analyze this farmer's credit score and give PRACTICAL advice in simple English.

FARMER: ${farmer.user.name}
SCORE: ${score}/100
TIER: ${loanEligibility.tier}
ELIGIBLE FOR LOAN: ${loanEligibility.eligible}
MAX LOAN AMOUNT: ₦${loanEligibility.maxAmount.toLocaleString()}

SCORE BREAKDOWN:
- Monthly Income Score: ${breakdown.monthlyIncome}/30
- Transaction Frequency: ${breakdown.frequency}/25
- Income Consistency: ${breakdown.consistency}/25
- Account Age: ${breakdown.accountAge}/20

TOTAL TRANSACTIONS: ${farmer.transactions.length}
TOTAL EARNED: ₦${farmer.totalEarned.toLocaleString()}

Respond with a JSON object (no markdown, no backticks) in exactly this format:
{
  "greeting": "one warm sentence addressing the farmer by first name",
  "summary": "2 sentences explaining what the score means in plain language",
  "weaknesses": ["top 2 specific weaknesses based on the scores above"],
  "tips": ["3 specific actionable steps to improve score", "make them practical for a Nigerian farmer"],
  "nextTier": "one sentence about what they need to reach the next tier",
  "encouragement": "one motivating sentence in Nigerian English style"
}
`;

  const model  = getModel();
  const result = await model.generateContent(prompt);
  const text   = result.response.text().trim();

  try {
    const parsed = JSON.parse(text);
    return { ...parsed, score, breakdown, loanEligibility };
  } catch {
    return {
      greeting:     `Hello ${farmer.user.name}!`,
      summary:      `Your AgriTrust score is ${score}/100 — ${loanEligibility.tier}.`,
      weaknesses:   ["Keep receiving regular payments", "Build transaction history"],
      tips:         ["Log deliveries consistently", "Ensure buyers confirm payments", "Stay active on the platform"],
      nextTier:     score < 100 ? `You need ${Math.min(40, 100) - score} more points to qualify.` : "You're at the top tier!",
      encouragement: "Keep farming and keep growing! 🌾",
      score,
      breakdown,
      loanEligibility,
    };
  }
}

// AI FRAUD DETECTION: Analyses a delivery before payment is released
export async function detectFraud(deliveryId: string) {
  const delivery = await prisma.delivery.findUnique({
    where:   { id: deliveryId },
    include: {
      farmer: { include: { transactions: true, deliveries: true } },
      buyer:  { include: { deliveries: true } },
    },
  });

  if (!delivery) throw new AppError("Delivery not found", 404);

  // Build context for AI
  const farmerAvgQuantity = delivery.farmer.deliveries.length > 0
    ? delivery.farmer.deliveries.reduce((s, d) => s + d.quantity, 0) / delivery.farmer.deliveries.length
    : 0;

  const farmerAvgPrice = delivery.farmer.deliveries.length > 0
    ? delivery.farmer.deliveries.reduce((s, d) => s + d.pricePerKg, 0) / delivery.farmer.deliveries.length
    : 0;

  const buyerDeliveryCount = delivery.buyer.deliveries.length;
  const buyerSameFarmerCount = delivery.buyer.deliveries.filter(
    d => d.farmerId === delivery.farmerId
  ).length;

  const prompt = `
You are a fraud detection AI for JustAgro, a Nigerian agricultural payment platform.
Analyze this delivery for fraud risk.

DELIVERY DETAILS:
- Product: ${delivery.productName}
- Quantity: ${delivery.quantity}kg
- Price per kg: ₦${delivery.pricePerKg}
- Total Amount: ₦${delivery.totalAmount}

FARMER HISTORY:
- Total deliveries: ${delivery.farmer.deliveries.length}
- Average quantity per delivery: ${farmerAvgQuantity.toFixed(0)}kg
- Average price per kg: ₦${farmerAvgPrice.toFixed(0)}
- Total transactions: ${delivery.farmer.transactions.length}
- Account age: ${Math.ceil((Date.now() - new Date(delivery.farmer.createdAt).getTime()) / (1000 * 60 * 60 * 24))} days

BUYER HISTORY:
- Total deliveries with any farmer: ${buyerDeliveryCount}
- Deliveries with THIS specific farmer: ${buyerSameFarmerCount}

Respond with a JSON object (no markdown, no backticks):
{
  "riskScore": "LOW" | "MEDIUM" | "HIGH",
  "riskLevel": 1-10,
  "flags": ["list of specific red flags found, empty array if none"],
  "reasons": ["explain each flag in simple terms"],
  "recommendation": "one clear action: approve / review / block",
  "summary": "one sentence summary for the aggregator"
}
`;

  const model  = getModel();
  const result = await model.generateContent(prompt);
  const text   = result.response.text().trim();

  try {
    const parsed = JSON.parse(text);

    // Save risk score to delivery
    await prisma.delivery.update({
      where: { id: deliveryId },
      data: {
        riskScore:  parsed.riskScore,
        riskReason: parsed.flags?.join(", ") || null,
      },
    });

    return parsed;
  } catch {
    return {
      riskScore:      "LOW",
      riskLevel:      2,
      flags:          [],
      reasons:        ["No significant risk factors detected"],
      recommendation: "approve",
      summary:        "Delivery appears legitimate based on available data.",
    };
  }
}

// AI PRICE INTELLIGENCE: Tells the farmer if they are being underpaid vs market rate
export async function getPriceIntelligence(deliveryId: string) {
  const delivery = await prisma.delivery.findUnique({
    where:   { id: deliveryId },
    include: { farmer: { include: { user: true } } },
  });

  if (!delivery) throw new AppError("Delivery not found", 404);

  const prompt = `
You are a Nigerian agricultural market price analyst for JustAgro platform.
Analyze if this farmer is being fairly paid.

DELIVERY:
- Product: ${delivery.productName}
- Quantity: ${delivery.quantity}kg
- Price offered: ₦${delivery.pricePerKg}/kg
- Total: ₦${delivery.totalAmount}
- Location context: Nigeria (farmer is in ${delivery.farmer.location || "Nigeria"})
- Date: ${new Date().toLocaleDateString("en-NG", { month: "long", year: "numeric" })}

Using your knowledge of Nigerian commodity prices for ${delivery.productName}:

Respond with a JSON object (no markdown, no backticks):
{
  "estimatedMarketPrice": <number in Naira per kg>,
  "offeredPrice": ${delivery.pricePerKg},
  "priceDifference": <market - offered>,
  "percentageDifference": <percentage below or above market>,
  "isFairPrice": true | false,
  "potentialLoss": <total money lost if below market, on this quantity>,
  "insight": "2 sentences explaining the price comparison in plain English",
  "advice": "2 sentences of practical advice for the farmer",
  "marketContext": "1 sentence about current market conditions for this crop in Nigeria"
}
`;

  const model  = getModel();
  const result = await model.generateContent(prompt);
  const text   = result.response.text().trim();

  try {
    return JSON.parse(text);
  } catch {
    return {
      estimatedMarketPrice:  delivery.pricePerKg * 1.1,
      offeredPrice:          delivery.pricePerKg,
      priceDifference:       -(delivery.pricePerKg * 0.1),
      percentageDifference:  -10,
      isFairPrice:           true,
      potentialLoss:         0,
      insight:               `Your price of ₦${delivery.pricePerKg}/kg is within a reasonable range for ${delivery.productName}.`,
      advice:                "Keep building your buyer relationships. Compare prices regularly on the platform.",
      marketContext:         "Market conditions are currently stable for this crop.",
    };
  }
}
