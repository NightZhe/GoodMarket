// standard-webhooks 簽章驗證（Supabase Auth Hooks 的 HTTP hook 用這個規格）。
// 只用 WebCrypto（Deno 與 Node 都內建），不加第三方依賴。
// 規格：簽章內容 = `${webhook-id}.${webhook-timestamp}.${原始 body}`，HMAC-SHA256，key 是 secret 的 base64 解碼結果；
//       webhook-signature 標頭是以空白分隔的 `v1,<base64>` 清單（GoTrue 用「, 」串接，所以逗號後面可能帶空白）。
// Supabase 的 secret 格式是 `v1,whsec_<base64>`；多把 secret 以「|」分隔（Supabase 的輪替格式；也接受空白）。

export const TOLERANCE_SEC = 300; // 時間戳容忍 5 分鐘（過去與未來都算）

const B64 = /^[A-Za-z0-9+/]+={0,2}$/;

function b64decode(s: string) {
  if (!B64.test(s) || s.length % 4 === 1) return null; // 回傳型別交給推論：Uint8Array<ArrayBuffer>｜null（WebCrypto 要求 ArrayBuffer 而非 SharedArrayBuffer）
  try {
    const bin = atob(s);
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

/** `v1,whsec_<b64>` / `whsec_<b64>` / `<b64>` → 金鑰 bytes；壞掉回 null（不丟例外）。 */
function secretKeyBytes(secret: string) {
  let s = secret;
  if (s.startsWith('v1,')) s = s.slice(3);
  if (s.startsWith('whsec_')) s = s.slice(6);
  return b64decode(s);
}

export interface VerifyInput {
  secrets: string | undefined;     // env SEND_SMS_HOOK_SECRET，多把以空白分隔
  id: string | null;               // webhook-id
  timestamp: string | null;        // webhook-timestamp（整數秒）
  signature: string | null;        // webhook-signature
  body: string;                    // 原始 body 字串（驗簽前不可 parse 再 stringify）
  nowMs: number;
}

export async function verifyWebhook(i: VerifyInput): Promise<boolean> {
  if (!i.secrets || !i.id || !i.timestamp || !i.signature) return false;
  if (!/^\d{1,12}$/.test(i.timestamp)) return false;
  if (Math.abs(Math.floor(i.nowMs / 1000) - Number(i.timestamp)) > TOLERANCE_SEC) return false;

  // 標頭裡每個 `v1,<sig>`；以空白切開後，逗號後面是簽章（尾巴可能多一個逗號）
  const sigs: NonNullable<ReturnType<typeof b64decode>>[] = [];
  for (const part of i.signature.split(/\s+/)) {
    const [version, b64] = part.split(',');
    if (version !== 'v1' || !b64) continue;
    const bytes = b64decode(b64);
    if (bytes) sigs.push(bytes);
  }
  if (sigs.length === 0) return false;

  const data = new TextEncoder().encode(`${i.id}.${i.timestamp}.${i.body}`);
  for (const secret of i.secrets.split(/[|\s]+/).filter(Boolean)) {
    const keyBytes = secretKeyBytes(secret);
    if (!keyBytes || keyBytes.length === 0) continue;
    const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    for (const s of sigs) {
      // subtle.verify 是常數時間比較
      if (await crypto.subtle.verify('HMAC', key, s, data)) return true;
    }
  }
  return false;
}
