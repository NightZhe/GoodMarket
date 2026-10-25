import { useState, type ReactNode } from 'react';
import { useToast } from '../Toast';
import { BLOCK_LIMIT } from '../../lib/block/store';
import { useBlockedShops, type UseBlockedShops } from '../../lib/block/useBlockedShops';
import BlockConfirm from './BlockConfirm';

type ShopRef = { id: string; name: string };

interface Options {
  /** 封鎖成功後（toast 已發出）：頁面可在這裡移焦點 */
  onBlocked?: (shop: ShopRef) => void;
  /** 取消封鎖成功後 */
  onUnblocked?: (shop: ShopRef) => void;
}

export interface BlockActions extends UseBlockedShops {
  /** 「封鎖此店家」：達上限就直接提示，否則開確認對話框 */
  ask: (shop: ShopRef) => void;
  /** 「取消封鎖」：可逆，不二次確認 */
  unblockShop: (shop: ShopRef) => void;
  /** 確認對話框，放進頁面的 JSX 裡 */
  dialog: ReactNode;
}

/** 封鎖／取消封鎖的流程與 toast（S-K9、S-K12、spec §11）。所有頁面共用，文案只寫在這裡 */
export function useBlockActions(opts: Options = {}): BlockActions {
  const toast = useToast();
  const blocked = useBlockedShops();
  const [pending, setPending] = useState<ShopRef | null>(null);

  const ask = (shop: ShopRef) => {
    if (blocked.isBlocked(shop.id)) return;
    if (blocked.shops.length >= BLOCK_LIMIT) {
      toast(`已封鎖 ${BLOCK_LIMIT} 家店，達到上限。請先取消封鎖一些店家。`, 'error');
      return;
    }
    setPending(shop);
  };

  const confirm = () => {
    if (!pending) return;
    const shop = pending;
    setPending(null);
    const r = blocked.block(shop);
    if (r === 'ok') { toast(`已封鎖『${shop.name}』`); opts.onBlocked?.(shop); }
    else if (r === 'full') toast(`已封鎖 ${BLOCK_LIMIT} 家店，達到上限。請先取消封鎖一些店家。`, 'error');
    else toast('無法在這台裝置記住封鎖，請檢查瀏覽器設定', 'error');
  };

  const unblockShop = (shop: ShopRef) => {
    if (blocked.unblock(shop.id)) { toast(`已取消封鎖『${shop.name}』`); opts.onUnblocked?.(shop); }
    else toast('無法在這台裝置取消封鎖，請檢查瀏覽器設定', 'error');
  };

  const dialog = pending ? <BlockConfirm shopName={pending.name} onConfirm={confirm} onCancel={() => setPending(null)} /> : null;
  return { ...blocked, ask, unblockShop, dialog };
}
