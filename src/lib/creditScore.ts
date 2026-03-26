// Feature for V2
import { Farmer } from "@prisma/client";

interface TxRecord {
  type:      string;
  amount:    number;
  createdAt: Date;
}

export interface ScoreResult {
  score:    number;
  breakdown: {
    monthlyIncome: number;
    frequency:     number;
    consistency:   number;
    accountAge:    number;
  };
}

export function calculateCreditScore(
  transactions: TxRecord[],
  farmer: Farmer
): ScoreResult {
  const payments = transactions.filter(t => t.type === "PAYMENT_RECEIVED");

  if (payments.length === 0) {
    return {
      score: 0,
      breakdown: { monthlyIncome: 0, frequency: 0, consistency: 0, accountAge: 0 },
    };
  }

  const monthsActive = Math.max(
    1,
    Math.ceil(
      (Date.now() - new Date(farmer.createdAt).getTime()) /
      (1000 * 60 * 60 * 24 * 30)
    )
  );

  // Monthly income (30 pts)
  const total         = payments.reduce((s, t) => s + t.amount, 0);
  const avgMonthly    = total / monthsActive;
  const incomeScore   =
    avgMonthly >= 500_000 ? 30 :
    avgMonthly >= 200_000 ? 25 :
    avgMonthly >= 100_000 ? 20 :
    avgMonthly >= 50_000  ? 15 :
    avgMonthly >= 20_000  ? 10 : 5;

  // Transaction frequency (25 pts)
  const freq          = payments.length / monthsActive;
  const freqScore     =
    freq >= 10 ? 25 :
    freq >= 5  ? 20 :
    freq >= 3  ? 15 :
    freq >= 1  ? 10 : 5;

  // Consistency (25 pts)
  let consistencyScore = 0;
  if (payments.length >= 2 && monthsActive >= 2) {
    const byMonth: Record<string, number> = {};
    payments.forEach(t => {
      const key = new Date(t.createdAt).toISOString().slice(0, 7);
      byMonth[key] = (byMonth[key] || 0) + t.amount;
    });
    const vals   = Object.values(byMonth);
    const avg    = vals.reduce((a, b) => a + b, 0) / vals.length;
    const stdDev = Math.sqrt(vals.reduce((s, v) => s + (v - avg) ** 2, 0) / vals.length);
    const cv     = avg > 0 ? stdDev / avg : 1;
    consistencyScore =
      cv < 0.2 ? 25 :
      cv < 0.4 ? 20 :
      cv < 0.6 ? 15 :
      cv < 0.8 ? 10 : 5;
  }

  // Account age (20 pts)
  // Only grant age points if they have actual transactions
  const ageScore =
    monthsActive >= 12 ? 20 :
    monthsActive >= 6  ? 16 :
    monthsActive >= 3  ? 12 :
    monthsActive >= 2  ? 8  : 4;

  const total_score = Math.min(
    100,
    incomeScore + freqScore + consistencyScore + ageScore
  );

  return {
    score: total_score,
    breakdown: {
      monthlyIncome: incomeScore,
      frequency:     freqScore,
      consistency:   consistencyScore,
      accountAge:    ageScore,
    },
  };
}
