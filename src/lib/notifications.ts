import axios from "axios";
import { prisma } from "../config/db";

const TERMII = "https://api.ng.termii.com/api";


const TEST_WHATSAPP = process.env.TEST_WHATSAPP_NUMBER || "";

function sanitizePhone(phone: string): string {
  // Convert 0XXXXXXXXXX - 234XXXXXXXXXX for international format
  if (phone.startsWith("0")) return "234" + phone.slice(1);
  if (phone.startsWith("+")) return phone.slice(1);
  return phone;
}

async function sendSMS(to: string, message: string): Promise<void> {
  const number = sanitizePhone(to);
  try {
    await axios.post(`${TERMII}/sms/send`, {
      to:      number,
      from:    process.env.TERMII_SENDER_ID || "JustAgro",
      sms:     message,
      type:    "plain",
      api_key: process.env.TERMII_API_KEY,
      channel: "generic",
    });
    console.log(`[SMS] Sent to ${number}`);
  } catch (err: any) {
    console.error(`[SMS] Failed to ${number}:`, err.response?.data?.message || err.message);
  }
}

async function sendWhatsApp(to: string, message: string): Promise<void> {
  // If TEST_WHATSAPP_NUMBER is set, route all WhatsApp to that number, check later - not routing
  const target = TEST_WHATSAPP ? sanitizePhone(TEST_WHATSAPP) : sanitizePhone(to);
  const prefix = TEST_WHATSAPP ? `[Demo→${sanitizePhone(to)}]\n` : "";

  try {
    await axios.post(`${TERMII}/sms/send`, {
      to:      target,
      from:    process.env.TERMII_SENDER_ID || "JustAgro",
      sms:     prefix + message,
      type:    "plain",
      api_key: process.env.TERMII_API_KEY,
      channel: "whatsapp",
    });
    console.log(`[WhatsApp] Sent to ${target}${TEST_WHATSAPP ? " (test override)" : ""}`);
  } catch (err: any) {
    console.error(`[WhatsApp] Failed:`, err.response?.data?.message || err.message);
    // Fall back to SMS if WhatsApp fails, fix later
    await sendSMS(to, message);
  }
}

async function saveInApp(userId: string, message: string, transactionId?: string): Promise<void> {
  try {
    await prisma.notification.create({
      data: { userId, transactionId, channel: "IN_APP", message, isRead: false },
    });
  } catch (err) {
    console.error("[InApp] Save failed:", err);
  }
}

export async function notifyBuyerPaymentLink(data: {
  buyerPhone: string; buyerName: string; farmerName: string;
  cropType: string; quantity: number; totalAmount: number; paymentLink: string;
}): Promise<void> {
  const msg =
    `Hello ${data.buyerName}! \n\n` +
    `JustAgro Payment Request:\n` +
    `Farmer: ${data.farmerName}\n` +
    `Produce: ${data.cropType} (${data.quantity}kg)\n` +
    `Amount: ₦${data.totalAmount.toLocaleString()}\n\n` +
    `Tap to pay securely:\n${data.paymentLink}\n\n` +
    `Powered by JustAgro `;

  await Promise.allSettled([
    sendSMS(data.buyerPhone, msg),
    sendWhatsApp(data.buyerPhone, msg),
  ]);
}

export async function notifyFarmerPayment(data: {
  farmerPhone: string; farmerName: string; farmerUserId: string;
  buyerName: string; cropType: string; quantity: number;
  farmerReceives: number; txnRef: string; transactionId: string;
}): Promise<void> {
  const msg =
    `Payment Received!\n\n` +
    `Buyer: ${data.buyerName}\n` +
    `Produce: ${data.cropType} (${data.quantity}kg)\n` +
    `You receive: ₦${data.farmerReceives.toLocaleString()}\n` +
    `Ref: ${data.txnRef}\n\n` +
    `JustAgro`;

  await Promise.allSettled([
    sendSMS(data.farmerPhone, msg),
    sendWhatsApp(data.farmerPhone, msg),
    saveInApp(data.farmerUserId, msg, data.transactionId),
  ]);
}

export async function notifyAggregatorPayment(data: {
  aggregatorUserId: string; farmerName: string; buyerName: string;
  cropType: string; totalAmount: number; platformFee: number;
  txnRef: string; transactionId: string;
}): Promise<void> {
  const msg =
    `Payment Confirmed\n\n` +
    `Farmer: ${data.farmerName} → Buyer: ${data.buyerName}\n` +
    `Produce: ${data.cropType}\n` +
    `Amount: ₦${data.totalAmount.toLocaleString()}\n` +
    `Platform fee: ₦${data.platformFee.toLocaleString()}\n` +
    `Ref: ${data.txnRef}`;

  await saveInApp(data.aggregatorUserId, msg, data.transactionId);
}

export async function notifyFarmerWelcome(data: {
  phone: string; name: string; accountNumber: string; bankName: string; userId: string;
}): Promise<void> {
  const msg =
    `Welcome to JustAgro, ${data.name}!\n\n` +
    `Your payment account:\n` +
    `Account: ${data.accountNumber}\n` +
    `Bank: ${data.bankName}\n\n` +
    `Share this with buyers to get paid directly!`;

  await Promise.allSettled([
    sendSMS(data.phone, msg),
    sendWhatsApp(data.phone, msg),
    saveInApp(data.userId, msg),
  ]);
}

export async function notifyWithdrawal(data: {
  farmerPhone: string; farmerName: string; farmerUserId: string;
  amount: number; reference: string;
}): Promise<void> {
  const msg =
    `Withdrawal Processed\n\n` +
    `Amount: ₦${data.amount.toLocaleString()}\n` +
    `Ref: ${data.reference}\n\n` +
    `Funds sent to your registered bank account.`;

  await Promise.allSettled([
    sendSMS(data.farmerPhone, msg),
    saveInApp(data.farmerUserId, msg),
  ]);
}
// Add icons to the message body later