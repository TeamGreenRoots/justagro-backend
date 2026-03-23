import { Router } from "express";
import { authenticate, requireRole } from "../../middleware/auth";
import {
  createDelivery,
  listDeliveries,
  getDelivery,
  initiatePayment,
  verifyPayment,
} from "./delivery.controller";

const router = Router();

// All delivery routes require authentication
router.use(authenticate);

/**
 * @swagger
 * /api/v1/deliveries:
 *   get:
 *     tags: [Deliveries]
 *     summary: List deliveries (role-based)
 *     description: |
 *       - **BUYER**: Returns their pending and paid deliveries
 *       - **FARMER**: Returns deliveries assigned to them
 *       - **AGGREGATOR**: Returns all deliveries they manage
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: tab
 *         schema:
 *           type: string
 *           enum: [pending, history]
 *         description: Filter tab (buyer only)
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [PENDING, PAID, CANCELLED, DISPUTED]
 *     responses:
 *       200:
 *         description: List of deliveries
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:    { type: boolean }
 *                 deliveries: { type: array, items: { $ref: '#/components/schemas/Delivery' } }
 */
router.get("/", listDeliveries);

/**
 * @swagger
 * /api/v1/deliveries:
 *   post:
 *     tags: [Deliveries]
 *     summary: Create a new delivery
 *     description: Only AGGREGATOR or FARMER can create deliveries
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateDeliveryRequest'
 *           example:
 *             farmerId:    "clx1234abcdef"
 *             buyerId:     "clx5678ghijkl"
 *             productName: "Maize"
 *             quantity:    500
 *             pricePerKg:  180
 *     responses:
 *       201:
 *         description: Delivery created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:  { type: boolean }
 *                 delivery: { $ref: '#/components/schemas/Delivery' }
 */
router.post("/", requireRole("AGGREGATOR", "FARMER"), createDelivery);

/**
 * @swagger
 * /api/v1/deliveries/{id}:
 *   get:
 *     tags: [Deliveries]
 *     summary: Get a single delivery by ID
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *         example: "clx1234abcdef"
 *     responses:
 *       200:
 *         description: Delivery details
 *       404:
 *         description: Delivery not found
 */
router.get("/:id", getDelivery);

/**
 * @swagger
 * /api/v1/deliveries/{id}/pay:
 *   post:
 *     tags: [Payments]
 *     summary: Initiate payment for a delivery (Buyer taps "Confirm & Pay")
 *     description: |
 *       Returns a payment URL for the Interswitch payment modal.
 *       The buyer is redirected to this URL to complete payment via Card or Bank Transfer.
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *         description: Delivery ID
 *     responses:
 *       200:
 *         description: Payment URL returned
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PaymentInitResponse'
 *       400:
 *         description: Delivery already paid or cancelled
 *       403:
 *         description: Not your delivery
 */
router.post("/:id/pay", requireRole("BUYER"), initiatePayment);

/**
 * @swagger
 * /api/v1/deliveries/{id}/verify:
 *   post:
 *     tags: [Payments]
 *     summary: Verify and confirm payment after Interswitch callback
 *     description: |
 *       Called after Interswitch redirects back to your app.
 *       This endpoint:
 *       1. Verifies payment with Interswitch
 *       2. Updates delivery status to PAID
 *       3. Records transaction with platform fee (1%)
 *       4. Updates farmer wallet balance
 *       5. Handles automatic loan repayment (15%)
 *       6. Recalculates credit score
 *       7. Generates digital receipt
 *       8. Sends SMS/WhatsApp to farmer, buyer & aggregator
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/PaymentVerifyRequest'
 *           example:
 *             reference:     "AGT_clx1234_1717200000000"
 *             paymentMethod: "CARD"
 *     responses:
 *       200:
 *         description: Payment confirmed and receipt generated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:  { type: boolean }
 *                 receipt:  { $ref: '#/components/schemas/Receipt' }
 *                 newScore: { type: integer, example: 71 }
 *                 message:  { type: string }
 *       400:
 *         description: Payment verification failed
 */
router.post("/:id/verify", requireRole("BUYER"), verifyPayment);

export default router;
