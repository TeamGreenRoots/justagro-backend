import { Router } from "express";
import { register, login, refreshToken, getMe } from "./auth.controller";
import { authenticate } from "../../middleware/auth";

const router = Router();

/**
 * @swagger
 * /api/v1/auth/register:
 *   post:
 *     tags: [Auth]
 *     summary: Register a new user
 *     description: Register as FARMER, BUYER, or AGGREGATOR. Farmers automatically get an Interswitch virtual account.
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/RegisterRequest'
 *           examples:
 *             farmer:
 *               summary: Register as Farmer
 *               value:
 *                 name: "Emeka Okafor"
 *                 phone: "08012345678"
 *                 password: "securepass123"
 *                 role: "FARMER"
 *                 farmName: "Emeka Rice Farm"
 *                 location: "Kano State"
 *                 cropTypes: ["Rice", "Maize"]
 *             buyer:
 *               summary: Register as Buyer
 *               value:
 *                 name: "AgroMart Nigeria"
 *                 phone: "08087654321"
 *                 password: "securepass123"
 *                 role: "BUYER"
 *                 companyName: "AgroMart Nigeria Ltd"
 *             aggregator:
 *               summary: Register as Aggregator
 *               value:
 *                 name: "Platform Admin"
 *                 phone: "08011112222"
 *                 password: "admin123"
 *                 role: "AGGREGATOR"
 *                 organizationName: "JustAgro HQ"
 *     responses:
 *       201:
 *         description: Registration successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 message: { type: string, example: "Registration successful" }
 *                 userId:  { type: string }
 *       409:
 *         description: Phone already registered
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post("/register", register);

/**
 * @swagger
 * /api/v1/auth/login:
 *   post:
 *     tags: [Auth]
 *     summary: Login and receive JWT tokens
 *     description: Returns accessToken (7 days) and refreshToken (30 days). Use accessToken in Authorization header.
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/LoginRequest'
 *           example:
 *             phone: "08012345678"
 *             password: "securepass123"
 *     responses:
 *       200:
 *         description: Login successful
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AuthResponse'
 *       401:
 *         description: Invalid credentials
 */
router.post("/login", login);

/**
 * @swagger
 * /api/v1/auth/refresh:
 *   post:
 *     tags: [Auth]
 *     summary: Refresh access token
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               refreshToken: { type: string }
 *     responses:
 *       200:
 *         description: New access token issued
 */
router.post("/refresh", refreshToken);

/**
 * @swagger
 * /api/v1/auth/me:
 *   get:
 *     tags: [Auth]
 *     summary: Get current authenticated user
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Current user profile
 *       401:
 *         description: Unauthorized
 */
router.get("/me", authenticate, getMe);

export default router;
