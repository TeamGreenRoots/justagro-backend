
import { Transaction, Farmer } from "@prisma/client";

export interface CreditScoreResult {
  score: number;
  breakdown: { monthlyIncome: number; frequency: number; consistency: number; accountAge: number; total: number };
  loanEligibility: { eligible: boolean; maxAmount: number; tier: string; reason?: string };
}

export function calculateCreditScore(transactions: Transaction[], farmer: Farmer): CreditScoreResult {
  const payments = transactions.filter(t => t.type === "PAYMENT_RECEIVED");
  const monthsActive = Math.max(1, Math.ceil(
    (Date.now() - new Date(farmer.createdAt).getTime()) / (1000 * 60 * 60 * 24 * 30)
  ));

  const totalReceived    = payments.reduce((s, t) => s + t.amount, 0);
  const avgMonthlyIncome = totalReceived / monthsActive;

  const monthlyIncomeScore =
    avgMonthlyIncome >= 500_000 ? 30 : avgMonthlyIncome >= 200_000 ? 25 :
    avgMonthlyIncome >= 100_000 ? 20 : avgMonthlyIncome >= 50_000  ? 15 :
    avgMonthlyIncome >= 20_000  ? 10 : avgMonthlyIncome > 0 ? 5 : 0;

  const freqPerMonth   = payments.length / monthsActive;
  const frequencyScore =
    freqPerMonth >= 10 ? 25 : freqPerMonth >= 5 ? 20 : freqPerMonth >= 3 ? 15 :
    freqPerMonth >= 1  ? 10 : payments.length > 0 ? 5 : 0;

  let consistencyScore = 0;
  if (monthsActive >= 2 && payments.length >= 2) {
    const byMonth: Record<string, number> = {};
    payments.forEach(t => {
      const key = new Date(t.createdAt).toISOString().slice(0, 7);
      byMonth[key] = (byMonth[key] || 0) + t.amount;
    });
    const vals  = Object.values(byMonth);
    const avg   = vals.reduce((a, b) => a + b, 0) / vals.length;
    const stdDev = Math.sqrt(vals.reduce((s, v) => s + Math.pow(v - avg, 2), 0) / vals.length);
    const cv    = avg > 0 ? stdDev / avg : 1;
    consistencyScore = cv < 0.2 ? 25 : cv < 0.4 ? 20 : cv < 0.6 ? 15 : cv < 0.8 ? 10 : 5;
  }

  const accountAgeScore =
    monthsActive >= 12 ? 20 : monthsActive >= 6 ? 16 :
    monthsActive >= 3  ? 12 : monthsActive >= 1 ? 8 : 4;

  const total = Math.min(100, monthlyIncomeScore + frequencyScore + consistencyScore + accountAgeScore);

  let tier = "Unqualified", eligible = false, maxAmount = 0;
  let reason = `Score is ${total}/100. Keep receiving payments to qualify.`;

  if (total >= 80) {
    tier = "Premium 🌟"; eligible = true;
    maxAmount = Math.min(avgMonthlyIncome * 3, 500_000);
  } else if (total >= 60) {
    tier = "Standard ✅"; eligible = true;
    maxAmount = Math.min(avgMonthlyIncome * 2, 100_000);
  } else if (total >= 40) {
    tier = "Starter 🟡"; eligible = true;
    maxAmount = Math.min(avgMonthlyIncome, 20_000);
  }

  return {
    score: total,
    breakdown: { monthlyIncome: monthlyIncomeScore, frequency: frequencyScore, consistency: consistencyScore, accountAge: accountAgeScore, total },
    loanEligibility: { eligible, maxAmount, tier, reason },
  };
}
