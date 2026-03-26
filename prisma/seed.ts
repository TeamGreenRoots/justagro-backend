import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Seeding JustAgro v2 demo data...\n");

  const hash       = await bcrypt.hash("demo1234", 12);
  const phoneHash  = await bcrypt.hash("08033221100", 12); // offline farmer pwd = phone

  const aggUser = await prisma.user.upsert({
    where:  { phone: "08000000001" },
    update: {},
    create: {
      name: "JustAgro Admin", phone: "08000000001",
      passwordHash: hash, role: "AGGREGATOR",
      aggregator: {
        create: { organizationName: "JustAgro HQ", commissionRate: 1.0 },
      },
    },
    include: { aggregator: true },
  });
  const agg = aggUser.aggregator!;
  console.log("Aggregator created:", aggUser.name);

  // FARMER 1 — Has smartphone, self-registered 
  const farmer1User = await prisma.user.upsert({
    where:  { phone: "08000000002" },
    update: {},
    create: {
      name: "Emeka Okafor", phone: "08000000002",
      passwordHash: hash, role: "FARMER",
      farmer: {
        create: {
          farmName:  "Emeka Rice Farm",
          location:  "Kano State",
          cropTypes: ["Rice", "Maize"],
          totalEarned:   450_000,
          walletBalance:  85_000,
        },
      },
    },
    include: { farmer: true },
  });
  const farmer1 = farmer1User.farmer!;
  console.log("Farmer 1 created (smartphone):", farmer1User.name);

  // FARMER 2 — No smartphone, registered by aggregator
  const farmer2User = await prisma.user.upsert({
    where:  { phone: "08033221100" },
    update: {},
    create: {
      name: "Musa Abdullahi", phone: "08033221100",
      passwordHash: phoneHash, role: "FARMER",
      farmer: {
        create: {
          farmName:    "Musa Tomato Farm",
          location:    "Kaduna State",
          cropTypes:   ["Tomatoes", "Pepper", "Onions"],
          registeredBy: agg.id,
          totalEarned:  120_000,
          walletBalance: 35_000,
        },
      },
    },
    include: { farmer: true },
  });
  const farmer2 = farmer2User.farmer!;
  console.log("Farmer 2 created (no smartphone):", farmer2User.name);

  // FARMER 3 — new, no transactions 
  const farmer3User = await prisma.user.upsert({
    where:  { phone: "08000000003" },
    update: {},
    create: {
      name: "Aisha Bello", phone: "08000000003",
      passwordHash: hash, role: "FARMER",
      farmer: {
        create: {
          farmName:  "Aisha Vegetable Farm",
          location:  "Sokoto State",
          cropTypes: ["Cabbage", "Spinach"],
        },
      },
    },
    include: { farmer: true },
  });
  const farmer3 = farmer3User.farmer!;
  console.log("Farmer 3 created (new, no transactions):", farmer3User.name);

  // BUYER (platform account) 
  const buyerUser = await prisma.user.upsert({
    where:  { phone: "08000000004" },
    update: {},
    create: {
      name: "AgroMart Nigeria", phone: "08000000004",
      passwordHash: hash, role: "BUYER",
      buyer: { create: { companyName: "AgroMart Nigeria Ltd" } },
    },
    include: { buyer: true },
  });
  console.log("Buyer created:", buyerUser.name);

  // BUYER CONTACTS (aggregator's saved contacts)
  const contact1 = await prisma.buyerContact.upsert({
    where:  { aggregatorId_phone: { aggregatorId: agg.id, phone: "08012345678" } },
    update: {},
    create: {
      aggregatorId: agg.id,
      name:         "Abubakar Grains Store",
      phone:        "08012345678",
      companyName:  "Abubakar & Sons Ltd",
      email:        "abubakar@grains.com",
    },
  });

  const contact2 = await prisma.buyerContact.upsert({
    where:  { aggregatorId_phone: { aggregatorId: agg.id, phone: "08098765432" } },
    update: {},
    create: {
      aggregatorId: agg.id,
      name:         "FarmConnect Abuja",
      phone:        "08098765432",
      companyName:  "FarmConnect Ltd",
    },
  });
  console.log("Buyer contacts created: 2");

  // INVENTORY
  const inv1 = await prisma.inventory.create({
    data: {
      farmerId:   farmer1.id,
      cropType:   "Rice",
      quantity:   1000,
      pricePerKg: 550,
      totalValue: 550_000,
      status:     "AVAILABLE",
      notes:      "Grade A, freshly harvested",
    },
  });

  const inv2 = await prisma.inventory.create({
    data: {
      farmerId:   farmer1.id,
      cropType:   "Maize",
      quantity:   800,
      pricePerKg: 180,
      totalValue: 144_000,
      status:     "AVAILABLE",
    },
  });

  // Aggregator added stock for offline farmer2
  const inv3 = await prisma.inventory.create({
    data: {
      farmerId:   farmer2.id,
      addedById:  agg.id,
      cropType:   "Tomatoes",
      quantity:   300,
      pricePerKg: 350,
      totalValue: 105_000,
      status:     "AVAILABLE",
      notes:      "Fresh, market-ready",
    },
  });

  const inv4 = await prisma.inventory.create({
    data: {
      farmerId:   farmer2.id,
      addedById:  agg.id,
      cropType:   "Pepper",
      quantity:   150,
      pricePerKg: 420,
      totalValue: 63_000,
      status:     "AVAILABLE",
    },
  });
  console.log("Inventory created: 4 items");

  // PAID TRANSACTION (history table) 
  const paidTxn = await prisma.transaction.create({
    data: {
      txnRef:         "AGT_1717200000000_0001",
      aggregatorId:   agg.id,
      farmerId:       farmer1.id,
      buyerContactId: contact1.id,
      cropType:       "Maize",
      quantity:       500,
      pricePerKg:     180,
      totalAmount:    90_000,
      platformFee:    900,
      farmerReceives: 89_100,
      status:         "PAID",
      paymentMethod:  "INTERSWITCH",
      interswitchRef: "AGT_1717200000000_0001",
      interswitchPay: "UBA|API|MX180335|01-12-2024|001|001",
      buyerNotified:  true,
      paymentLink:    "http://localhost:3000/pay/AGT_1717200000000_0001",
      paidAt:         new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
    },
  });

  await prisma.receipt.create({
    data: {
      transactionId:  paidTxn.id,
      txnRef:         paidTxn.txnRef,
      farmerName:     "Emeka Okafor",
      farmName:       "Emeka Rice Farm",
      buyerName:      "Abubakar Grains Store",
      cropType:       "Maize",
      quantity:       500,
      pricePerKg:     180,
      totalAmount:    90_000,
      platformFee:    900,
      farmerReceives: 89_100,
      paymentMethod:  "INTERSWITCH",
      paidAt:         new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
    },
  });

  // ASSISTED TRANSACTION 
  const assistedTxn = await prisma.transaction.create({
    data: {
      txnRef:         "AGT_1717200000000_0002",
      aggregatorId:   agg.id,
      farmerId:       farmer2.id,
      buyerContactId: contact2.id,
      cropType:       "Tomatoes",
      quantity:       200,
      pricePerKg:     350,
      totalAmount:    70_000,
      platformFee:    700,
      farmerReceives: 69_300,
      status:         "ASSISTED",
      paymentMethod:  "ASSISTED",
      buyerNotified:  true,
      paymentLink:    "http://localhost:3000/pay/AGT_1717200000000_0002",
      notes:          "Cash paid in person at farm",
      paidAt:         new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
    },
  });

  await prisma.receipt.create({
    data: {
      transactionId:  assistedTxn.id,
      txnRef:         assistedTxn.txnRef,
      farmerName:     "Musa Abdullahi",
      farmName:       "Musa Tomato Farm",
      buyerName:      "FarmConnect Abuja",
      cropType:       "Tomatoes",
      quantity:       200,
      pricePerKg:     350,
      totalAmount:    70_000,
      platformFee:    700,
      farmerReceives: 69_300,
      paymentMethod:  "ASSISTED",
      paidAt:         new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
    },
  });

  // PENDING TRANSACTIONS (for demo) 
  const pending1 = await prisma.transaction.create({
    data: {
      txnRef:         "AGT_1717200000000_0003",
      aggregatorId:   agg.id,
      farmerId:       farmer1.id,
      buyerContactId: contact1.id,
      cropType:       "Rice",
      quantity:       300,
      pricePerKg:     550,
      totalAmount:    165_000,
      platformFee:    1_650,
      farmerReceives: 163_350,
      status:         "PENDING",
      buyerNotified:  true,
      paymentLink:    "http://localhost:3000/pay/AGT_1717200000000_0003",
    },
  });

  await prisma.inventory.create({
    data: {
      farmerId:      farmer1.id,
      cropType:      "Rice",
      quantity:      300,
      pricePerKg:    550,
      totalValue:    165_000,
      status:        "RESERVED",
      transactionId: pending1.id,
    },
  });

  await prisma.transaction.create({
    data: {
      txnRef:         "AGT_1717200000000_0004",
      aggregatorId:   agg.id,
      farmerId:       farmer2.id,
      buyerContactId: contact2.id,
      cropType:       "Pepper",
      quantity:       100,
      pricePerKg:     420,
      totalAmount:    42_000,
      platformFee:    420,
      farmerReceives: 41_580,
      status:         "PENDING",
      buyerNotified:  false,
      paymentLink:    "http://localhost:3000/pay/AGT_1717200000000_0004",
    },
  });

  console.log("Transactions created: 4 (2 paid/assisted, 2 pending)\n");

  console.log(`
═══════════════════════════════════════════════
  DEMO ACCOUNTS (all passwords: demo1234)
═══════════════════════════════════════════════

  AGGREGATOR
  Phone: 08000000001  | Password: demo1234

  FARMER 1 (smartphone, has stock)
  Phone: 08000000002  | Password: demo1234

  FARMER 2 (no smartphone — default pwd = phone)
  Phone: 08033221100  | Password: 08033221100

  FARMER 3 (new, no transactions)
  Phone: 08000000003  | Password: demo1234

  BUYER
  Phone: 08000000004  | Password: demo1234

═══════════════════════════════════════════════
  PAYMENT LINKS (open in browser to test):
  http://localhost:3000/pay/AGT_1717200000000_0003
  http://localhost:3000/pay/AGT_1717200000000_0004
═══════════════════════════════════════════════
  `);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
