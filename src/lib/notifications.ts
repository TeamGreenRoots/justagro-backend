// fix the termii client ID and API LATER!!
// USE THE EMOJI TO DETECT THE MESSAGE EASIER
import axios from "axios";
import { prisma } from "../config/db";

const TERMII = "https://api.ng.termii.com/api";

async function sendSMS(to: string, message: string) {
  try {
    await axios.post(`${TERMII}/sms/send`, {
      to, from: process.env.TERMII_SENDER_ID || "JustAgro",
      sms: message, type: "plain",
      api_key: process.env.TERMII_API_KEY, channel: "generic",
    });
  } catch (err: any) { console.error("SMS failed:", err.response?.data || err.message); }
}

async function sendWhatsApp(to: string, message: string) {
  try {
    await axios.post(`${TERMII}/sms/send`, {
      to, from: process.env.TERMII_SENDER_ID || "JustAgro",
      sms: message, type: "plain",
      api_key: process.env.TERMII_API_KEY, channel: "whatsapp",
    });
  } catch (err: any) { console.error("WhatsApp failed:", err.response?.data || err.message); }
}

async function saveInApp(userId: string, message: string, deliveryId?: string) {
  await prisma.notification.create({
    data: { userId, deliveryId, channel: "IN_APP", status: "SENT", message, isRead: false },
  });
}

export async function notifyFarmerWelcome(data: {
  phone: string; name: string; accountNumber: string; bankName: string; userId: string;
}) {
  const msg = `🌾 Welcome to JustAgro, ${data.name}!\n\nYour virtual account:\nAccount: ${data.accountNumber}\nBank: ${data.bankName}\n\nShare with buyers to get paid directly!`;
  await Promise.allSettled([sendSMS(data.phone, msg), sendWhatsApp(data.phone, msg), saveInApp(data.userId, msg)]);
}

export async function notifyFarmerPaymentReceived(data: {
  farmerPhone: string; farmerName: string; farmerUserId: string; buyerName: string;
  productName: string; quantity: number; amount: number; receiptCode: string;
  deliveryId: string; newScore: number;
}) {
  const msg = `💰 Payment Received!\n\nBuyer: ${data.buyerName}\nProduct: ${data.productName} (${data.quantity}kg)\nAmount: ₦${data.amount.toLocaleString()}\nReceipt: ${data.receiptCode}\n\nAgriTrust Score: ${data.newScore}/100 📈`;
  await Promise.allSettled([sendSMS(data.farmerPhone, msg), sendWhatsApp(data.farmerPhone, msg), saveInApp(data.farmerUserId, msg, data.deliveryId)]);
}

export async function notifyBuyerPaymentSuccess(data: {
  buyerPhone: string; buyerName: string; buyerUserId: string; farmerName: string;
  productName: string; amount: number; receiptCode: string; deliveryId: string;
}) {
  const msg = `✅ Payment Successful!\n\nPaid: ₦${data.amount.toLocaleString()}\nFarmer: ${data.farmerName}\nProduct: ${data.productName}\nReceipt: ${data.receiptCode}`;
  await Promise.allSettled([sendSMS(data.buyerPhone, msg), saveInApp(data.buyerUserId, msg, data.deliveryId)]);
}

export async function notifyAggregatorPayment(data: {
  aggregatorPhone: string; aggregatorUserId: string; farmerName: string; buyerName: string;
  productName: string; amount: number; platformFee: number; receiptCode: string; deliveryId: string;
}) {
  const msg = `📊 Payment Processed\n\nFarmer: ${data.farmerName}\nBuyer: ${data.buyerName}\nAmount: ₦${data.amount.toLocaleString()}\nPlatform Fee: ₦${data.platformFee.toLocaleString()}\nReceipt: ${data.receiptCode}`;
  await Promise.allSettled([sendSMS(data.aggregatorPhone, msg), saveInApp(data.aggregatorUserId, msg, data.deliveryId)]);
}

export async function notifyFarmerLoanDisbursed(data: {
  phone: string; name: string; userId: string; amount: number; totalRepayable: number;
}) {
  const msg = `🏦 Loan Approved!\n\nAmount: ₦${data.amount.toLocaleString()}\nRepayable: ₦${data.totalRepayable.toLocaleString()}\n15% auto-deducted from each payment.\n\nKeep farming! 🌾`;
  await Promise.allSettled([sendSMS(data.phone, msg), sendWhatsApp(data.phone, msg), saveInApp(data.userId, msg)]);
}
