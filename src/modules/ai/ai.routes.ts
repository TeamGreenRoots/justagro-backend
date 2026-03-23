import { Router } from "express";
import { authenticate, requireRole } from "../../middleware/auth";
import { scoreExplainer, fraudCheck, priceIntelligence } from "./ai.controller";

const router = Router();
router.use(authenticate);

/**
 * @swagger
 * /api/v1/ai/score-explain:
 *   get:
 *     tags: [AI]
 *     summary: AI Credit Score Explainer
 *     description: |
 *       Uses Google Gemini AI (FREE) to analyze the farmer's credit score
 *       and return **personalized, actionable advice** in plain English.
 *
 *       Returns:
 *       - Why their score is what it is
 *       - Top 2 weaknesses to fix
 *       - 3 specific steps to improve
 *       - How far they are from the next loan tier
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: AI-generated credit score analysis
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:      { type: boolean }
 *                 explanation:
 *                   $ref: '#/components/schemas/AIScoreExplanation'
 *       403:
 *         description: Only farmers can access this
 */
router.get("/score-explain", requireRole("FARMER"), scoreExplainer);

/**
 * @swagger
 * /api/v1/ai/fraud-check/{deliveryId}:
 *   get:
 *     tags: [AI]
 *     summary: AI Fraud Detection on Delivery
 *     description: |
 *       Analyses a delivery for fraud risk before payment is released.
 *       Checks for:
 *       - Unusual quantity (vs farmer's history)
 *       - Suspicious pricing (above/below market)
 *       - Repeated buyer-farmer collusion patterns
 *       - New account with large transactions
 *
 *       Returns a **LOW / MEDIUM / HIGH** risk rating with specific flags.
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
 *         description: Fraud analysis result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 result:  { $ref: '#/components/schemas/AIFraudResult' }
 */
router.get("/fraud-check/:deliveryId", requireRole("AGGREGATOR"), fraudCheck);

/**
 * @swagger
 * /api/v1/ai/price-intelligence/{deliveryId}:
 *   get:
 *     tags: [AI]
 *     summary: AI Market Price Intelligence
 *     description: |
 *       Compares the delivery price against current Nigerian market rates.
 *       Tells the farmer if they're being **underpaid** and by how much.
 *
 *       Example: If market rate for Maize is ₦185/kg but buyer offered ₦120/kg,
 *       AI shows: "You are 35% below market. On 500kg that's ₦32,500 left on the table."
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
 *         description: Price intelligence report
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 report:  { $ref: '#/components/schemas/AIPriceIntelligence' }
 */
router.get("/price-intelligence/:deliveryId", requireRole("FARMER", "AGGREGATOR"), priceIntelligence);

export default router;
