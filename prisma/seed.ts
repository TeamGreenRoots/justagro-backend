import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  console.log(">>>>> Seeding demo data...");

  const hash = await bcrypt.hash("demo1234", 12);

  // Aggregator 
  const aggUser = await prisma.user.upsert({
    where:  { phone: "08000000001" },
    update: {},
    create: {
      name: "JustAgro Admin", phone: "08000000001",
      passwordHash: hash, role: "AGGREGATOR",
      aggregator: { create: { organizationName: "JustAgro HQ", commissionRate: 1.0 } },
    },
    include: { aggregator: true },
  });

  // Farmer 1 (high score - has transactions) 
  const farmer1User = await prisma.user.upsert({
    where:  { phone: "08000000002" },
    update: {},
    create: {
      name: "Emeka Okafor", phone: "08000000002",
      passwordHash: hash, role: "FARMER",
      farmer: {
        create: {
          farmName: "Emeka Rice Farm", location: "Kano State",
          cropTypes: ["Rice", "Maize"],
          virtualAccountNo: "0123456789", bankName: "Access Bank", bankCode: "044",
          creditScore: 72, totalEarned: 450_000, walletBalance: 85_000,
        },
      },
    },
    include: { farmer: true },
  });

  // Farmer 2 (new - low score) 
  const farmer2User = await prisma.user.upsert({
    where:  { phone: "08000000003" },
    update: {},
    create: {
      name: "Aisha Bello", phone: "08000000003",
      passwordHash: hash, role: "FARMER",
      farmer: {
        create: {
          farmName: "Aisha Vegetable Farm", location: "Kaduna State",
          cropTypes: ["Tomatoes", "Pepper"],
          virtualAccountNo: "0987654321", bankName: "GTBank", bankCode: "058",
          creditScore: 28, totalEarned: 45_000, walletBalance: 12_000,
        },
      },
    },
    include: { farmer: true },
  });

  // Buyer 1 
  const buyer1User = await prisma.user.upsert({
    where:  { phone: "08000000004" },
    update: {},
    create: {
      name: "AgroMart Nigeria", phone: "08000000004",
      passwordHash: hash, role: "BUYER",
      buyer: { create: { companyName: "AgroMart Nigeria Ltd" } },
    },
    include: { buyer: true },
  });

  // Buyer 2 
  const buyer2User = await prisma.user.upsert({
    where:  { phone: "08000000005" },
    update: {},
    create: {
      name: "FarmConnect Ltd", phone: "08000000005",
      passwordHash: hash, role: "BUYER",
      buyer: { create: { companyName: "FarmConnect Ltd" } },
    },
    include: { buyer: true },
  });

  const farmer1 = farmer1User.farmer!;
  const farmer2 = farmer2User.farmer!;
  const buyer1  = buyer1User.buyer!;
  const buyer2  = buyer2User.buyer!;
  const agg     = aggUser.aggregator!;

  // Past transactions for Farmer1 (builds credit score)
  const txDates = [
    { daysAgo: 90, amount: 135_000 },
    { daysAgo: 75, amount: 112_000 },
    { daysAgo: 60, amount: 98_000  },
    { daysAgo: 45, amount: 155_000 },
    { daysAgo: 30, amount: 127_000 },
    { daysAgo: 15, amount: 143_000 },
    { daysAgo: 5,  amount: 85_000  },
  ];

  for (const tx of txDates) {
    const date = new Date(Date.now() - tx.daysAgo * 24 * 60 * 60 * 1000);
    await prisma.transaction.create({
      data: {
        farmerId:    farmer1.id,
        type:        "PAYMENT_RECEIVED",
        amount:      tx.amount,
        platformFee: tx.amount * 0.01,
        netAmount:   tx.amount * 0.99,
        description: "Payment from buyer",
        status:      "SUCCESS",
        createdAt:   date,
      },
    });
  }

  // Paid delivery with receipt 
  const paidDelivery = await prisma.delivery.create({
    data: {
      farmerId:      farmer1.id,
      buyerId:       buyer1.id,
      aggregatorId:  agg.id,
      productName:   "Maize",
      quantity:      500,
      pricePerKg:    180,
      totalAmount:   90_000,
      status:        "PAID",
      receiptCode:   "AGT-20241201-0001",
      paidAt:        new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
      interswitchRef: "ISW_MOCK_001",
      paymentMethod: "CARD",
      riskScore:     "LOW",
    },
  });

  await prisma.receipt.create({
    data: {
      deliveryId:    paidDelivery.id,
      receiptCode:   "AGT-20241201-0001",
      farmerName:    "Emeka Okafor",
      buyerName:     "AgroMart Nigeria",
      productName:   "Maize",
      quantity:      500,
      amount:        90_000,
      paymentMethod: "CARD",
      paidAt:        new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
    },
  });

  // 3 Pending deliveries (for demo) 
  await prisma.delivery.createMany({
    data: [
      {
        farmerId: farmer1.id, buyerId: buyer1.id, aggregatorId: agg.id,
        productName: "Rice", quantity: 300, pricePerKg: 550, totalAmount: 165_000,
        status: "PENDING", receiptCode: "AGT-20241202-0002", riskScore: "LOW",
      },
      {
        farmerId: farmer1.id, buyerId: buyer2.id, aggregatorId: agg.id,
        productName: "Sorghum", quantity: 200, pricePerKg: 220, totalAmount: 44_000,
        status: "PENDING", receiptCode: "AGT-20241202-0003", riskScore: "MEDIUM",
      },
      {
        farmerId: farmer2.id, buyerId: buyer1.id, aggregatorId: agg.id,
        productName: "Tomatoes", quantity: 100, pricePerKg: 350, totalAmount: 35_000,
        status: "PENDING", receiptCode: "AGT-20241202-0004", riskScore: "LOW",
      },
    ],
  });

  // Active loan for farmer1 
  await prisma.loan.create({
    data: {
      farmerId:      farmer1.id,
      amount:        50_000,
      interestRate:  5.0,
      totalRepayable: 52_500,
      amountRepaid:  7_875,
      status:        "REPAYING",
      disbursedAt:   new Date(Date.now() - 20 * 24 * 60 * 60 * 1000),
      dueDate:       new Date(Date.now() + 70 * 24 * 60 * 60 * 1000),
    },
  });

  console.log(`
  ✅ >>>>> Seed complete! <<<<<

  ─────────────────────────────────────────
  👤 DEMO ACCOUNTS (password: demo1234)
  ─────────────────────────────────────────
  Aggregator : 08000000001
  Farmer 1   : 08000000002  (score: 72, has loan)
  Farmer 2   : 08000000003  (score: 28, new)
  Buyer 1    : 08000000004
  Buyer 2    : 08000000005
  ─────────────────────────────────────────
  `);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
