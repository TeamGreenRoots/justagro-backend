import { Router, Request, Response, NextFunction } from "express";
import { prisma } from "../../config/db";
import { authenticate, requireRole } from "../../middleware/auth";
import { AppError } from "../../middleware/errorHandler";

const router = Router();
router.use(authenticate, requireRole("AGGREGATOR"));

/**
 * @swagger
 * /api/v1/buyer-contacts:
 *   get:
 *     tags: [Buyers]
 *     summary: Get all buyers — saved contacts + registered platform buyers
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 10 }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: All buyer contacts + registered buyers
 */
router.get("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page   = Math.max(1, parseInt(req.query.page  as string) || 1);
    const limit  = Math.min(50, parseInt(req.query.limit as string) || 10);
    const skip   = (page - 1) * limit;
    const search = req.query.search as string | undefined;

    
    const contactWhere: any = { aggregatorId: req.user!.aggregatorId };
    if (search) {
      contactWhere.OR = [
        { name:  { contains: search, mode: "insensitive" } },
        { phone: { contains: search } },
      ];
    }

    // Get registered Buyer platform accounts
    const buyerWhere: any = {};
    if (search) {
      buyerWhere.user = {
        OR: [
          { name:  { contains: search, mode: "insensitive" } },
          { phone: { contains: search } },
        ],
      };
    }

    const [contacts, platformBuyers, contactTotal, buyerTotal] = await Promise.all([
      prisma.buyerContact.findMany({
        where:   contactWhere,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.buyer.findMany({
        where:   buyerWhere,
        include: { user: { select: { name: true, phone: true, email: true, createdAt: true } } },
        orderBy: { createdAt: "desc" },
      }),
      prisma.buyerContact.count({ where: contactWhere }),
      prisma.buyer.count({ where: buyerWhere }),
    ]);

    // Normalize platform buyers to same shape as contacts
    const normalizedBuyers = platformBuyers.map(b => ({
      id:          b.id,
      name:        b.user.name,
      phone:       b.user.phone,
      email:       b.user.email,
      companyName: null,
      source:      "PLATFORM",    // differentiate from contacts
      buyerId:     b.id,
      createdAt:   b.createdAt,
    }));

    const normalizedContacts = contacts.map(c => ({ ...c, source: "CONTACT" }));

    // Merge — platform buyers first (they have accounts), then contacts
    const merged = [
      ...normalizedBuyers,
      ...normalizedContacts.filter(c =>
        // exclude contacts that are already linked to a platform account
        !c.buyerId
      ),
    ];

    const total = buyerTotal + contactTotal;

    res.json({
      success: true,
      data:    merged,
      pagination: {
        page, limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (err) { next(err); }
});

/**
 * @swagger
 * /api/v1/buyer-contacts:
 *   post:
 *     tags: [Buyers]
 *     summary: Add a new buyer contact (manual entry)
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, phone]
 *             properties:
 *               name:        { type: string }
 *               phone:       { type: string }
 *               email:       { type: string }
 *               companyName: { type: string }
 *     responses:
 *       201:
 *         description: Contact saved
 */
router.post("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, phone, email, companyName } = req.body;
    if (!name || !phone) throw new AppError("name and phone are required", 400);

    const contact = await prisma.buyerContact.upsert({
      where:  { aggregatorId_phone: { aggregatorId: req.user!.aggregatorId!, phone } },
      update: { name, email: email || null, companyName: companyName || null },
      create: {
        aggregatorId: req.user!.aggregatorId!,
        name, phone,
        email:       email       || null,
        companyName: companyName || null,
      },
    });

    res.status(201).json({ success: true, data: { ...contact, source: "CONTACT" } });
  } catch (err) { next(err); }
});

router.delete("/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const c = await prisma.buyerContact.findUnique({ where: { id: req.params.id } });
    if (!c || c.aggregatorId !== req.user!.aggregatorId) throw new AppError("Not found", 404);
    await prisma.buyerContact.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) { next(err); }
});

export default router;
