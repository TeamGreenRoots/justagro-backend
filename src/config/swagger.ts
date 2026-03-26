import swaggerJsdoc from "swagger-jsdoc";

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "JustAgro API",
      version: "1.0.0",
      description: `
## JustAgro — Farmer Credit & Payment Platform

Built for the **Interswitch | Enyata Hackathon 2026**.


### Roles
| Role | Access |
|------|--------|
| FARMER | Own dashboard, own inventory, own transactions |
| BUYER | Own transactions pushed by aggregator |
| AGGREGATOR | Full platform — farmers, inventory, transactions, buyers |

### Payment Flow
1. Aggregator creates transaction → buyer gets WhatsApp/SMS link
2. Buyer opens \`/pay/:txnRef\` (public — no login needed)
3. Interswitch popup opens - buyer pays
4. Backend verifies with Interswitch \`gettransaction.json\`
5. Status - PAID - receipt generated - PDF downloadable
      `,
    },
    servers: [
      { url: "http://localhost:5000", description: "Local" },
      { url: "https://justagro-api.railway.app", description: "Production" },
    ],
    components: {
      securitySchemes: {
        BearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
        },
      },
      schemas: {
        Error: {
          type: "object",
          properties: {
            success: { type: "boolean", example: false },
            error:   { type: "string" },
            message: { type: "string" },
          },
        },
        AuthResponse: {
          type: "object",
          properties: {
            success:      { type: "boolean" },
            accessToken:  { type: "string" },
            refreshToken: { type: "string" },
            user: {
              type: "object",
              properties: {
                id:    { type: "string" },
                name:  { type: "string" },
                phone: { type: "string" },
                role:  { type: "string", enum: ["FARMER", "BUYER", "AGGREGATOR"] },
              },
            },
          },
        },
        Inventory: {
          type: "object",
          properties: {
            id:         { type: "string" },
            cropType:   { type: "string", example: "Maize" },
            quantity:   { type: "number", example: 500 },
            pricePerKg: { type: "number", example: 180 },
            totalValue: { type: "number", example: 90000 },
            status:     { type: "string", enum: ["AVAILABLE", "RESERVED", "SOLD"] },
            notes:      { type: "string", nullable: true },
            farmer: {
              type: "object",
              properties: {
                farmName: { type: "string" },
                location: { type: "string" },
                user:     { type: "object", properties: { name: { type: "string" }, phone: { type: "string" } } },
              },
            },
          },
        },
        Transaction: {
          type: "object",
          properties: {
            id:            { type: "string" },
            txnRef:        { type: "string", example: "AGT-20241201-0001" },
            cropType:      { type: "string" },
            quantity:      { type: "number" },
            pricePerKg:    { type: "number" },
            totalAmount:   { type: "number" },
            farmerReceives:{ type: "number" },
            platformFee:   { type: "number" },
            status:        { type: "string", enum: ["PENDING", "PAID", "ASSISTED", "CANCELLED"] },
            paymentMethod: { type: "string", enum: ["INTERSWITCH", "ASSISTED"], nullable: true },
            paymentLink:   { type: "string" },
            paidAt:        { type: "string", format: "date-time", nullable: true },
          },
        },
        BuyerContact: {
          type: "object",
          properties: {
            id:          { type: "string" },
            name:        { type: "string", example: "Abubakar Stores" },
            phone:       { type: "string", example: "08012345678" },
            email:       { type: "string", nullable: true },
            companyName: { type: "string", nullable: true },
          },
        },
      },
    },
    security: [{ BearerAuth: [] }],
    tags: [
      { name: "Auth",         description: "Register, Login, Refresh" },
      { name: "Farmer",       description: "Farmer dashboard and profile" },
      { name: "Inventory",    description: "Stock management — farmer adds own, aggregator adds for offline farmer" },
      { name: "Transactions", description: "Core business flow — create, pay, verify, receipt" },
      { name: "Buyers",       description: "Aggregator buyer contact list" },
      { name: "Aggregator",   description: "Platform overview and management" },
      { name: "Notifications",description: "In-app alerts" },
      { name: "Public",       description: "No auth required — payment page data" },
    ],
  },
  apis: ["./src/modules/**/*.routes.ts"],
};

export const swaggerSpec = swaggerJsdoc(options);
