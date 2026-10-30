// 環境變數（Supabase secrets）。金鑰只從這裡讀，不寫進程式碼、不寫進日誌。
// 平台收款（PR-乙，spec §4 S-5；decisions E1＝A）：綠界帳戶類型與本站收款商店編號由 secret 決定，缺設或值錯就拒絕啟動（fail closed）：
//   ECPAY_ACCOUNT_TYPE  merchant（一般特店：不帶 PlatformID，外層與 Data 的 MerchantID 都是 ECPAY_MERCHANT_ID，用本站自己的 HashKey／IV，R12）
//                       platform（平台商：外層與 Data 帶 ECPAY_PLATFORM_ID，Data.MerchantID＝ECPAY_MERCHANT_ID，用平台商的 HashKey／IV）
//   ECPAY_MERCHANT_ID   本站用來收款的商店編號；綁卡、授權、查詢、請款、放棄、退刷都用它（不再有「綁卡在 A、授權在 B」；舊 ECPAY_BIND_MERCHANT_ID 不再使用）
import { ecpayBases, type EcpayConfig } from './ecpayClient.ts';

export type Getter = (k: string) => string | undefined;

export interface AppConfig {
  supabaseUrl: string;
  serviceKey: string;
  anonKey: string;
  /** 綠界帳戶類型（E1：沒設就不啟動） */
  accountType: 'merchant' | 'platform';
  ecpay: EcpayConfig;
  bindAmount: number;         // 綁卡驗證金額（綠界要求的最低交易金額，後台查）
  functionsBaseUrl: string;   // 綠界打得到的公開網址，例如 https://<ref>.supabase.co/functions/v1
  siteUrl: string;            // 前端網址（含 GitHub Pages 子路徑），綁卡結果導回用
  cronSecret?: string;
  /** 管理函式（payment-admin-revoke-account-cards）的密碼。只存在使用者的密碼管理員，不放資料庫 Vault（D34＝B） */
  adminSecret?: string;
  allowedOrigins: string[];
}

export const MERCHANT_ID_RE = /^[0-9]{7,10}$/;

/** 純函式：從任一 getter 讀設定（測試用假的 env；正式用 Deno.env）。任何缺設或格式錯都丟 Error，呼叫端回 500／503，不打綠界。 */
export function parseConfig(get: Getter): AppConfig {
  const need = (k: string): string => {
    const v = get(k);
    if (!v) throw new Error(`missing env ${k}`);
    return v;
  };
  const opt = (k: string): string | undefined => get(k) || undefined;
  const env = (opt('ECPAY_ENV') ?? 'stage') as 'stage' | 'prod';
  if (env !== 'stage' && env !== 'prod') throw new Error('ECPAY_ENV must be stage or prod');
  const accountType = get('ECPAY_ACCOUNT_TYPE');
  if (accountType !== 'merchant' && accountType !== 'platform') throw new Error('ECPAY_ACCOUNT_TYPE must be merchant or platform');
  const merchantId = need('ECPAY_MERCHANT_ID');
  if (!MERCHANT_ID_RE.test(merchantId)) throw new Error('ECPAY_MERCHANT_ID must be 7-10 digits');
  const platformId = accountType === 'platform' ? need('ECPAY_PLATFORM_ID') : undefined;
  if (platformId !== undefined && !MERCHANT_ID_RE.test(platformId)) throw new Error('ECPAY_PLATFORM_ID must be 7-10 digits');
  const functionsBaseUrl = need('PAYMENT_FUNCTIONS_BASE_URL').replace(/\/$/, '');
  return {
    supabaseUrl: need('SUPABASE_URL'),
    serviceKey: need('SUPABASE_SERVICE_ROLE_KEY'),
    anonKey: need('SUPABASE_ANON_KEY'),
    accountType,
    ecpay: {
      env, merchantId, platformId, hashKey: need('ECPAY_HASH_KEY'), hashIv: need('ECPAY_HASH_IV'),
      ...ecpayBases(env), payReturnUrl: `${functionsBaseUrl}/payment-pay-return`,
    },
    bindAmount: Number(opt('ECPAY_BIND_AMOUNT') ?? '500'),
    functionsBaseUrl,
    siteUrl: need('PAYMENT_SITE_URL').replace(/\/$/, ''),
    cronSecret: opt('PAYMENT_CRON_SECRET'),
    adminSecret: opt('PAYMENT_ADMIN_SECRET'),
    allowedOrigins: (opt('PAYMENT_ALLOWED_ORIGINS') ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  };
}

let cached: AppConfig | null = null;
export function loadConfig(): AppConfig {
  if (cached) return cached;
  cached = parseConfig((k) => Deno.env.get(k));
  return cached;
}
