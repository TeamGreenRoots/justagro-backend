import { Router, Request, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { prisma } from "../../config/db";
import { authenticate } from "../../middleware/auth";
import { AppError } from "../../middleware/errorHandler";

const router = Router();
function generateTokens(payload: object) {
  const accessToken = jwt.sign(payload, process.env.JWT_SECRET!, {
    expiresIn: "7d",
  } as jwt.SignOptions);
  const refreshToken = jwt.sign(payload, process.env.JWT_REFRESH_SECRET!, {
    expiresIn: "30d",
  } as jwt.SignOptions);
  return { accessToken, refreshToken };
}

/**
 * @swagger
 * /api/v1/auth/register:
 *   post:
 *     tags: [Auth]
 *     summary: Register new user
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, phone, password, role]
 *             properties:
 *               name:             { type: string, example: "Emeka Okafor" }
 *               phone:            { type: string, example: "08012345678" }
 *               password:         { type: string, example: "securepass123", minLength: 6 }
 *               role:             { type: string, enum: [FARMER, BUYER, AGGREGATOR] }
 *               farmName:         { type: string, description: "FARMER only" }
 *               location:         { type: string, description: "FARMER only" }
 *               cropTypes:        { type: array, items: { type: string }, description: "FARMER only" }
 *               companyName:      { type: string, description: "BUYER only" }
 *               organizationName: { type: string, description: "AGGREGATOR only" }
 *     responses:
 *       201:
 *         description: Registered successfully
 *       409:
 *         description: Phone already registered
 */
router.post("/register", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const {
      name, phone, password, role,
      farmName, location, cropTypes,
      companyName, organizationName,
    } = req.body;

    if (!name || !phone || !password || !role) {
      throw new AppError("name, phone, password, role are required", 400);
    }
    if (!["FARMER", "BUYER", "AGGREGATOR"].includes(role)) {
      throw new AppError("role must be FARMER, BUYER, or AGGREGATOR", 400);
    }
    if (password.length < 6) {
      throw new AppError("Password must be at least 6 characters", 400);
    }

    const existing = await prisma.user.findUnique({ where: { phone } });
    if (existing) throw new AppError("Phone number already registered", 409);

    const passwordHash = await bcrypt.hash(password, 12);

    const user = await prisma.user.create({
      data: {
        name, phone, passwordHash, role,
        ...(role === "FARMER" && {
          farmer: {
            create: {
              farmName: farmName || `${name}'s Farm`,
              location: location || "Nigeria",
              cropTypes: Array.isArray(cropTypes) ? cropTypes : [],
            },
          },
        }),
        ...(role === "BUYER" && {
          buyer: { create: { companyName: companyName || null } },
        }),
        ...(role === "AGGREGATOR" && {
          aggregator: { create: { organizationName: organizationName || `${name} Org` } },
        }),
      },
      include: { farmer: true, buyer: true, aggregator: true },
    });

    res.status(201).json({
      success: true,
      message: "Registration successful",
      userId:  user.id,
      role:    user.role,
    });
  } catch (err) { next(err); }
});

/**
 * @swagger
 * /api/v1/auth/login:
 *   post:
 *     tags: [Auth]
 *     summary: Login and get tokens
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [phone, password]
 *             properties:
 *               phone:    { type: string, example: "08012345678" }
 *               password: { type: string, example: "securepass123" }
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
router.post("/login", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { phone, password } = req.body;
    if (!phone || !password) throw new AppError("phone and password required", 400);

    const user = await prisma.user.findUnique({
      where:   { phone },
      include: { farmer: true, buyer: true, aggregator: true },
    });

    if (!user || !user.isActive) throw new AppError("Invalid phone or password", 401);

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) throw new AppError("Invalid phone or password", 401);

    const payload = {
      userId:       user.id,
      role:         user.role,
      farmerId:     user.farmer?.id      || null,
      buyerId:      user.buyer?.id       || null,
      aggregatorId: user.aggregator?.id  || null,
    };

    const { accessToken, refreshToken } = generateTokens(payload);

    await prisma.refreshToken.create({
      data: {
        token:     refreshToken,
        userId:    user.id,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });

    res.json({
      success: true,
      accessToken,
      refreshToken,
      user: {
        id:           user.id,
        name:         user.name,
        phone:        user.phone,
        role:         user.role,
        farmerId:     user.farmer?.id      || null,
        buyerId:      user.buyer?.id       || null,
        aggregatorId: user.aggregator?.id  || null,
      },
    });
  } catch (err) { next(err); }
});

/**
 * @swagger
 * /api/v1/auth/refresh:
 *   post:
 *     tags: [Auth]
 *     summary: Refresh access token
 *     security: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               refreshToken: { type: string }
 *     responses:
 *       200:
 *         description: New access token
 */
router.post("/refresh", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) throw new AppError("refreshToken required", 400);

    const stored = await prisma.refreshToken.findUnique({ where: { token: refreshToken } });
    if (!stored || stored.expiresAt < new Date()) {
      throw new AppError("Invalid or expired refresh token", 401);
    }

    const payload = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET!) as any;
    const { iat, exp, ...clean } = payload;
    const { accessToken } = generateTokens(clean);

    res.json({ success: true, accessToken });
  } catch (err) { next(err); }
});

/**
 * @swagger
 * /api/v1/auth/me:
 *   get:
 *     tags: [Auth]
 *     summary: Get current user
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Current user profile
 */
router.get("/me", authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = await prisma.user.findUnique({
      where:   { id: req.user!.userId },
      include: { farmer: true, buyer: true, aggregator: true },
    });
    if (!user) throw new AppError("User not found", 404);
    const { passwordHash, ...safe } = user;
    res.json({ success: true, user: safe });
  } catch (err) { next(err); }
});

export default router;
