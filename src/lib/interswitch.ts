import axios from "axios";

const BASE_URL      = process.env.INTERSWITCH_BASE_URL     || "https://qa.interswitchng.com";
const MERCHANT_CODE = process.env.INTERSWITCH_MERCHANT_CODE || "MX180335";
const PAY_ITEM_ID   = process.env.INTERSWITCH_PAY_ITEM_ID  || "";

export function generateTxnRef(): string {
  const ts     = Date.now();
  const random = Math.floor(1000 + Math.random() * 9000);
  return `AGT_${ts}_${random}`;
}

export function getPaymentConfig(data: {
  txnRef:      string;
  amountNaira: number;
  custEmail:   string;
  custName:    string;
  custPhone?:  string;
  redirectUrl: string;
}): Record<string, any> {
  const amountKobo = Math.round(data.amountNaira * 100); // change from integer kobo to whole naira

  const config = {
    merchant_code:     MERCHANT_CODE,
    pay_item_id:       PAY_ITEM_ID,
    txn_ref:           data.txnRef,
    amount:            amountKobo,
    currency:          566,          // NGN ISO code
    cust_email:        data.custEmail || "customer@justagro.com",
    cust_name:         data.custName  || "JustAgro Customer",
    cust_mobile_no:    data.custPhone || "",
    site_redirect_url: data.redirectUrl,
    mode:              process.env.NODE_ENV === "production" ? "LIVE" : "TEST",
  };

  // Log config for debugging (remove when deploying / production)
  // console.log("[Interswitch] Payment config:", {
  //   merchant_code: config.merchant_code,
  //   pay_item_id:   config.pay_item_id,
  //   txn_ref:       config.txn_ref,
  //   amount:        config.amount,
  //   mode:          config.mode,
  // });

  return config;
}

export interface VerifyResult {
  success:          boolean;
  responseCode:     string;
  responseDesc:     string;
  amount:           number;
  amountNaira:      number;
  paymentReference: string;
  merchantRef:      string;
}

export async function verifyTransaction(
  txnRef:       string,
  expectedKobo: number
): Promise<VerifyResult> {
  const url = `${BASE_URL}/collections/api/v1/gettransaction.json`;

  try {
    const res = await axios.get(url, {
      params: {
        merchantcode:         MERCHANT_CODE,
        transactionreference: txnRef,
        amount:               expectedKobo,
      },
      headers: { "Content-Type": "application/json" },
      timeout: 20_000,
    });

    const d = res.data;
    console.log("[Interswitch] Verify response:", JSON.stringify(d));

    const success =
      d.ResponseCode === "00" &&
      Number(d.Amount) === expectedKobo;

    return {
      success,
      responseCode:     d.ResponseCode        || "",
      responseDesc:     d.ResponseDescription || "",
      amount:           Number(d.Amount)       || 0,
      amountNaira:      (Number(d.Amount) || 0) / 100,
      paymentReference: d.PaymentReference    || "",
      merchantRef:      d.MerchantReference   || txnRef,
    };

  } catch (err: any) {
    const status   = err.response?.status;
    const errData  = err.response?.data;
    console.error("[Interswitch] Verify error:", status, errData || err.message);

    const isNetworkError = !err.response; // no response = network/timeout issue

    if (isNetworkError && process.env.NODE_ENV !== "production") {
      console.warn("[Interswitch] Network error — using sandbox fallback");
      return {
        success:          true,
        responseCode:     "00",
        responseDesc:     "Approved (sandbox fallback — network error)",
        amount:           expectedKobo,
        amountNaira:      expectedKobo / 100,
        paymentReference: `SANDBOX_${txnRef}`,
        merchantRef:      txnRef,
      };
    }

    // Real Interswitch error — return it, don't swallow
    return {
      success:          false,
      responseCode:     errData?.ResponseCode     || "ERR",
      responseDesc:     errData?.ResponseDescription || err.message || "Verification failed",
      amount:           0,
      amountNaira:      0,
      paymentReference: "",
      merchantRef:      txnRef,
    };
  }
}

export function getCheckoutScriptUrl(): string {
  return process.env.NODE_ENV === "production"
    ? "https://newwebpay.interswitchng.com/inline-checkout.js"
    : "https://newwebpay.qa.interswitchng.com/inline-checkout.js";
}
