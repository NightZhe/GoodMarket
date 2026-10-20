// 環境變數（Supabase secrets）。金鑰只從這裡讀，不寫進程式碼、不寫進日誌。
import { ecpayBases, type EcpayConfig } from './ecpayClient.ts';

const need = (k: string): string => {
  const v = Deno.env.get(k);
  if (!v) throw new Error(`missing env ${k}`);
  return v;
};
const opt = (k: string): string | undefined => Deno.env.get(k) || undefined;

export interface AppConfig {
  supabaseUrl: string;
  serviceKey: string;
  anonKey: string;
  ecpay: EcpayConfig;
  bindMerchantId: string;     // 綁卡用的特約商店編號（綁卡的最低金額授權會在這家店的帳上，隨後放棄）
  bindAmount: number;         // 綁卡驗證金額（綠界要求的最低交易金額，後台查）
  functionsBaseUrl: string;   // 綠界打得到的公開網址，例如 https://<ref>.supabase.co/functions/v1
  siteUrl: string;            // 前端網址（含 GitHub Pages 子路徑），綁卡結果導回用
  cronSecret?: string;
  /** 管理函式（payment-admin-revoke-account-cards）的密碼。只存在使用者的密碼管理員，不放資料庫 Vault（D34＝B） */
  adminSecret?: string;
  allowedOrigins: string[];
}

let cached: AppConfig | null = null;
export function loadConfig(): AppConfig {
  if (cached) return cached;
  const env = (opt('ECPAY_ENV') ?? 'stage') as 'stage' | 'prod';
  if (env !== 'stage' && env !== 'prod') throw new Error('ECPAY_ENV must be stage or prod');
  const functionsBaseUrl = need('PAYMENT_FUNCTIONS_BASE_URL').replace(/\/$/, '');
  cached = {
    supabaseUrl: need('SUPABASE_URL'),
    serviceKey: need('SUPABASE_SERVICE_ROLE_KEY'),
    anonKey: need('SUPABASE_ANON_KEY'),
    ecpay: {
      env, platformId: need('ECPAY_PLATFORM_ID'), hashKey: need('ECPAY_HASH_KEY'), hashIv: need('ECPAY_HASH_IV'),
      ...ecpayBases(env), payReturnUrl: `${functionsBaseUrl}/payment-pay-return`,
    },
    bindMerchantId: need('ECPAY_BIND_MERCHANT_ID'),
    bindAmount: Number(opt('ECPAY_BIND_AMOUNT') ?? '500'),
    functionsBaseUrl,
    siteUrl: need('PAYMENT_SITE_URL').replace(/\/$/, ''),
    cronSecret: opt('PAYMENT_CRON_SECRET'),
    adminSecret: opt('PAYMENT_ADMIN_SECRET'),
    allowedOrigins: (opt('PAYMENT_ALLOWED_ORIGINS') ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  };
  return cached;
}
