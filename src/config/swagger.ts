// For swagger Docs
import swaggerJsdoc from "swagger-jsdoc";

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "JustAgro API",
      version: "1.0.0",
      description: `
## JustAgro — Farmer Credit & Payment Platform

Built for the **Enyata | Interswitch Hackathon 2026**.

### Overview
JustAgro connects farmers, buyers, and aggregators through a transparent payment and credit system powered by Interswitch.

### Authentication
All protected routes require a **Bearer JWT token**.
1. Register at \`POST /api/v1/auth/register\`
2. Login at \`POST /api/v1/auth/login\`
3. Copy the \`accessToken\` from the response
4. Click **Authorize** above and enter: \`Bearer <your_token>\`

### Roles
| Role | Description |
|------|-------------|
| \`FARMER\` | Receives payments, builds credit score, accesses loans |
| \`BUYER\` | Views pending deliveries, makes payments via Interswitch |
      `,
      // contact: {
      //   name:  "JustAgro Team",
      //   email: "michelleutomi@gmail.com",
      // },
      // license: {
      //   name: "MIT",
      // },
    },
    servers: [
      {
        url:         "http://localhost:5000",
        description: "Development Server",
      },
      {
        url:         "https://justagro-api.railway.app",
        description: "Production Server",
      },
    ],
    components: {
      securitySchemes: {
        BearerAuth: {
          type:         "http",
          scheme:       "bearer",
          bearerFormat: "JWT",
          description:  "Enter your JWT access token from /auth/login",
        },
      },
      schemas: {
        // AUTH 
        RegisterRequest: {
          type:     "object",
          required: ["name", "phone", "password", "role"],
          properties: {
            name:             { type: "string",  example: "Emeka Okafor" },
            phone:            { type: "string",  example: "08012345678" },
            password:         { type: "string",  example: "securepass123", minLength: 6 },
            role:             { type: "string",  enum: ["FARMER", "BUYER", "AGGREGATOR"] },
            farmName:         { type: "string",  example: "Emeka Rice Farm",  description: "FARMER only" },
            location:         { type: "string",  example: "Kano State",       description: "FARMER only" },
            cropTypes:        { type: "array",   items: { type: "string" },   example: ["Rice", "Maize"], description: "FARMER only" },
            companyName:      { type: "string",  example: "AgroMart Ltd",     description: "BUYER only" },
            organizationName: { type: "string",  example: "JustAgro HQ",      description: "AGGREGATOR only" },
          },
        },
        LoginRequest: {
          type:     "object",
          required: ["phone", "password"],
          properties: {
            phone:    { type: "string", example: "08012345678" },
            password: { type: "string", example: "securepass123" },
          },
        },
        AuthResponse: {
          type: "object",
          properties: {
            success:      { type: "boolean", example: true },
            accessToken:  { type: "string",  example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." },
            refreshToken: { type: "string",  example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." },
            user: {
              type: "object",
              properties: {
                id:    { type: "string" },
                name:  { type: "string" },
                phone: { type: "string" },
                role:  { type: "string" },
              },
            },
          },
        },

        // DELIVERY 
        CreateDeliveryRequest: {
          type:     "object",
          required: ["farmerId", "buyerId", "productName", "quantity", "pricePerKg"],
          properties: {
            farmerId:    { type: "string",  example: "clx1234abcdef" },
            buyerId:     { type: "string",  example: "clx5678ghijkl" },
            productName: { type: "string",  example: "Maize" },
            quantity:    { type: "number",  example: 500,   description: "in kg" },
            pricePerKg:  { type: "number",  example: 180,   description: "in Naira" },
          },
        },
        Delivery: {
          type: "object",
          properties: {
            id:           { type: "string" },
            productName:  { type: "string" },
            quantity:     { type: "number" },
            pricePerKg:   { type: "number" },
            totalAmount:  { type: "number" },
            status:       { type: "string", enum: ["PENDING", "PAID", "CANCELLED", "DISPUTED"] },
            receiptCode:  { type: "string", example: "AGT-20241201-0001" },
            riskScore:    { type: "string", enum: ["LOW", "MEDIUM", "HIGH"] },
            paidAt:       { type: "string", format: "date-time", nullable: true },
            farmer: {
              type: "object",
              properties: {
                id:       { type: "string" },
                farmName: { type: "string" },
                user:     { type: "object", properties: { name: { type: "string" }, phone: { type: "string" } } },
              },
            },
            buyer: {
              type: "object",
              properties: {
                id:   { type: "string" },
                user: { type: "object", properties: { name: { type: "string" } } },
              },
            },
          },
        },

        // PAYMENT 
        PaymentInitResponse: {
          type: "object",
          properties: {
            success:    { type: "boolean", example: true },
            paymentUrl: { type: "string",  example: "https://sandbox.interswitchng.com/pay?ref=AGT_xxx" },
            reference:  { type: "string",  example: "AGT_clx1234_1717200000000" },
          },
        },
        PaymentVerifyRequest: {
          type:     "object",
          required: ["reference"],
          properties: {
            reference:     { type: "string", example: "AGT_clx1234_1717200000000" },
            paymentMethod: { type: "string", example: "CARD", enum: ["CARD", "BANK_TRANSFER"] },
          },
        },

        // CREDIT SCORE 
        CreditScore: {
          type: "object",
          properties: {
            score: { type: "integer", example: 67, minimum: 0, maximum: 100 },
            breakdown: {
              type: "object",
              properties: {
                monthlyIncome: { type: "integer", example: 20, description: "max 30" },
                frequency:     { type: "integer", example: 20, description: "max 25" },
                consistency:   { type: "integer", example: 15, description: "max 25" },
                accountAge:    { type: "integer", example: 12, description: "max 20" },
              },
            },
            loanEligibility: {
              type: "object",
              properties: {
                eligible:  { type: "boolean", example: true },
                tier:      { type: "string",  example: "Standard +" },
                maxAmount: { type: "number",  example: 75000 },
                reason:    { type: "string",  nullable: true },
              },
            },
          },
        },

        // LOAN 
        LoanRequest: {
          type:     "object",
          required: ["amount"],
          properties: {
            amount: { type: "number", example: 50000, description: "Loan amount in Naira" },
          },
        },
        Loan: {
          type: "object",
          properties: {
            id:            { type: "string" },
            amount:        { type: "number", example: 50000 },
            interestRate:  { type: "number", example: 5.0,   description: "Flat 5%" },
            totalRepayable:{ type: "number", example: 52500 },
            amountRepaid:  { type: "number", example: 7875 },
            status:        { type: "string", enum: ["PENDING","APPROVED","DISBURSED","REPAYING","COMPLETED","REJECTED"] },
            disbursedAt:   { type: "string", format: "date-time", nullable: true },
            dueDate:       { type: "string", format: "date-time", nullable: true },
          },
        },

        // RECEIPT 
        Receipt: {
          type: "object",
          properties: {
            id:            { type: "string" },
            receiptCode:   { type: "string",  example: "AGT-20241201-0001" },
            farmerName:    { type: "string",  example: "Emeka Okafor" },
            buyerName:     { type: "string",  example: "AgroMart Nigeria" },
            productName:   { type: "string",  example: "Maize" },
            quantity:      { type: "number",  example: 500 },
            amount:        { type: "number",  example: 90000 },
            paymentMethod: { type: "string",  example: "CARD" },
            paidAt:        { type: "string",  format: "date-time" },
            whatsappUrl:   { type: "string",  example: "https://wa.me/?text=..." },
          },
        },

        // AI 
        AIScoreExplanation: {
          type: "object",
          properties: {
            explanation: { type: "string",  example: "Your score is 67/100. Main weakness is income consistency..." },
            tips:        { type: "array",   items: { type: "string" }, example: ["Log 3+ deliveries/month", "Target ₦50k+ monthly"] },
            nextTier:    { type: "string",  example: "You need 13 more points to reach Premium tier 🌟" },
          },
        },
        AIFraudResult: {
          type: "object",
          properties: {
            riskScore:  { type: "string", enum: ["LOW", "MEDIUM", "HIGH"], example: "MEDIUM" },
            reasons:    { type: "array",  items: { type: "string" }, example: ["Quantity 3x above farmer average"] },
            recommendation: { type: "string", example: "Review before processing payment" },
          },
        },
        AIPriceIntelligence: {
          type: "object",
          properties: {
            marketPrice:  { type: "number", example: 185,  description: "Current ₦/kg market rate" },
            yourPrice:    { type: "number", example: 120,  description: "Price in this delivery" },
            difference:   { type: "number", example: -65 },
            insight:      { type: "string", example: "You are priced 35% below market. On 500kg that's ₦32,500 lost." },
            advice:       { type: "string", example: "Consider renegotiating with buyer or finding new buyers on the platform." },
          },
        },

        // ERRORS 
        ErrorResponse: {
          type: "object",
          properties: {
            success: { type: "boolean", example: false },
            error:   { type: "string",  example: "Unauthorized" },
            message: { type: "string",  example: "Invalid or expired token" },
          },
        },
      },
    },
    security: [{ BearerAuth: [] }],
    tags: [
      { name: "Auth",          description: "Registration and login for all roles" },
      { name: "Farmer",        description: "Farmer dashboard, profile, virtual account" },
      { name: "Buyer",         description: "Buyer dashboard, pending and paid deliveries" },
      { name: "Aggregator",    description: "Platform overview, manage farmers and buyers" },
      { name: "Deliveries",    description: "Create and manage deliveries" },
      { name: "Payments",      description: "Interswitch payment initiation and verification" },
      { name: "Loans",         description: "Microloan application and history" },
      { name: "Receipts",      description: "Digital receipt retrieval and sharing" },
      { name: "AI",            description: "AI-powered credit explainer, fraud detection, price intelligence" },
      { name: "Notifications", description: "In-app notification management" },
      { name: "Webhooks",      description: "Interswitch payment webhook" },
    ],
  },
  apis: ["./src/modules/**/*.routes.ts"],
};

export const swaggerSpec = swaggerJsdoc(options);
