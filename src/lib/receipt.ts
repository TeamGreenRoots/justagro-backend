import { prisma } from "../config/db";

export async function generateReceiptCode(): Promise<string> {
  const date  = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const count = await prisma.receipt.count();
  return `AGT-${date}-${String(count + 1).padStart(4, "0")}`;
}

export async function createReceipt(data: {
  deliveryId: string; receiptCode: string; farmerName: string;
  buyerName: string; productName: string; quantity: number;
  amount: number; paymentMethod: string; paidAt: Date;
}) {
  return prisma.receipt.create({ data });
}

export function buildWhatsAppShareUrl(receipt: {
  receiptCode: string; farmerName: string; productName: string;
  quantity: number; amount: number; paidAt: Date;
}): string {
  const text = encodeURIComponent(
    `✅ *PAYMENT RECEIPT — JustAgro*\n\n` +
    `Receipt: *${receipt.receiptCode}*\n` +
    `Farmer: ${receipt.farmerName}\n` +
    `Product: ${receipt.productName} (${receipt.quantity}kg)\n` +
    `Amount: ₦${receipt.amount.toLocaleString()}\n` +
    `Date: ${new Date(receipt.paidAt).toLocaleDateString("en-NG", { day: "numeric", month: "long", year: "numeric" })}\n\n` +
    `Powered by JustAgro 🌾`
  );
  return `https://wa.me/?text=${text}`;
}
