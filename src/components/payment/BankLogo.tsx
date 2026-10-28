import { useState } from 'react';
import { bankLogoUrl } from '../../data/bankLogos';
import { useBankLogosEnabled } from '../../lib/payment/useBankLogos';

/**
 * 銀行 logo。伺服器端開關（get_bank_ui_config）關著或還沒讀到、沒有這家的檔案、或圖載入失敗：什麼都不畫（不留空格、不留破圖），旁邊的銀行名就是資訊本身。
 * alt 為空：名字就在旁邊，避免重複朗讀。
 */
export default function BankLogo({ code, size, className = '' }: { code: string; size: number; className?: string }) {
  const bankLogos = useBankLogosEnabled();
  const [failed, setFailed] = useState(false);
  const url = bankLogoUrl(code, bankLogos);
  if (!url || failed) return null;
  return (
    <img
      src={url} alt="" width={size} height={size} onError={() => setFailed(true)} draggable={false}
      className={`shrink-0 object-contain ${className}`} style={{ width: size, height: size }}
    />
  );
}
