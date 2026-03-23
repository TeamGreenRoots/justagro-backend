import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { prisma } from "../../config/db";
import { createVirtualAccount } from "../../lib/interswitch";
import { notifyFarmerWelcome } from "../../lib/notifications";
import { AppError } from "../../middleware/errorHandler";

interface RegisterInput {
  name:             string;
  phone:            string;
  password:         string;
  role:             "FARMER" | "BUYER" | "AGGREGATOR";
  farmName?:        string;
  location?:        string;
  cropTypes?:       string[];
  companyName?:     string;
  organizationName?: string;
}

export async function registerUser(input: RegisterInput) {
  const existing = await prisma.user.findUnique({ where: { phone: input.phone } });
  if (existing) throw new AppError("Phone number already registered", 409);

  if (input.password.length < 6) throw new AppError("Password must be at least 6 characters", 400);

  const passwordHash = await bcrypt.hash(input.password, 12);

  const user = await prisma.user.create({
    data: {
      name:         input.name,
      phone:        input.phone,
      passwordHash,
      role:         input.role,
      ...(input.role === "FARMER" && {
        farmer: {
          create: {
            farmName:  input.farmName  || `${input.name}'s Farm`,
            location:  input.location  || "Nigeria",
            cropTypes: input.cropTypes || [],
          },
        },
      }),
      ...(input.role === "BUYER" && {
        buyer: {
          create: { companyName: input.companyName || null },
        },
      }),
      ...(input.role === "AGGREGATOR" && {
        aggregator: {
          create: { organizationName: input.organizationName || `${input.name} Org` },
        },
      }),
    },
    include: { farmer: true, buyer: true, aggregator: true },
  });

  // Create virtual account for farmers
  if (input.role === "FARMER" && user.farmer) {
    try {
      const va = await createVirtualAccount({
        farmerId: user.farmer.id,
        name:     user.name,
        phone:    user.phone,
      });

      await prisma.farmer.update({
        where: { id: user.farmer.id },
        data: {
          virtualAccountNo: va.accountNumber,
          bankName:         va.bankName,
          bankCode:         va.bankCode,
        },
      });

      await notifyFarmerWelcome({
        phone:         user.phone,
        name:          user.name,
        accountNumber: va.accountNumber,
        bankName:      va.bankName,
        userId:        user.id,
      });
    } catch (err) {
      console.error("Post-register setup error:", err);
    }
  }

  return { userId: user.id, message: "Registration successful" };
}

function generateTokens(payload: object) {
  const accessToken = jwt.sign(payload, process.env.JWT_SECRET!, {
    expiresIn: process.env.JWT_EXPIRES_IN || "7d",
  } as jwt.SignOptions);

  const refreshToken = jwt.sign(payload, process.env.JWT_REFRESH_SECRET!, {
    expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || "30d",
  } as jwt.SignOptions);

  return { accessToken, refreshToken };
}

export async function loginUser(phone: string, password: string) {
  const user = await prisma.user.findUnique({
    where:   { phone },
    include: { farmer: true, buyer: true, aggregator: true },
  });

  if (!user || !user.isActive) throw new AppError("Invalid phone or password", 401);

  const isValid = await bcrypt.compare(password, user.passwordHash);
  if (!isValid) throw new AppError("Invalid phone or password", 401);

  const payload = {
    userId:       user.id,
    role:         user.role,
    farmerId:     user.farmer?.id     || null,
    buyerId:      user.buyer?.id      || null,
    aggregatorId: user.aggregator?.id || null,
  };

  const { accessToken, refreshToken } = generateTokens(payload);

  // Save refresh token
  await prisma.refreshToken.create({
    data: {
      token:     refreshToken,
      userId:    user.id,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  });

  return {
    accessToken,
    refreshToken,
    user: {
      id:    user.id,
      name:  user.name,
      phone: user.phone,
      role:  user.role,
    },
  };
}

export async function refreshAccessToken(token: string) {
  const stored = await prisma.refreshToken.findUnique({ where: { token } });
  if (!stored || stored.expiresAt < new Date()) {
    throw new AppError("Invalid or expired refresh token", 401);
  }

  const payload = jwt.verify(token, process.env.JWT_REFRESH_SECRET!) as any;
  const { iat, exp, ...cleanPayload } = payload;

  const { accessToken } = generateTokens(cleanPayload);
  return { accessToken };
}

export async function getUserById(userId: string) {
  const user = await prisma.user.findUnique({
    where:   { id: userId },
    include: { farmer: true, buyer: true, aggregator: true },
    omit:    { passwordHash: true } as any,
  });
  if (!user) throw new AppError("User not found", 404);
  return user;
}
