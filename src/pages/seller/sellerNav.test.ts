import { describe, expect, it } from 'vitest';
import { hasOwnBackHeader, hasSaveTray, hidesNav, homeButtonCompact, isChatThreadPath, sellerTabRoutes, showsHomeButton, subPageOwnsPadding } from './sellerNav';
import { needsShellInset } from '../../lib/native/shellInset';

describe('hidesNav：哪些賣家頁不出現分頁導覽（膠囊與直立軌）', () => {
  it('物流店到店與地址表單頁有鍵盤，導覽隱藏（AC-25）', () => {
    expect(hidesNav('/seller/logistics/stores/new')).toBe(true);
    expect(hidesNav('/seller/logistics/stores/s1')).toBe(true);
    expect(hidesNav('/seller/logistics/address')).toBe(true);
  });

  it('新增銀行帳號、選銀行、簡訊驗證頁有鍵盤，導覽隱藏；銀行帳號列表本身有導覽', () => {
    for (const p of ['/seller/payout/bank-accounts/new', '/seller/payout/bank-accounts/new/bank', '/seller/payout/bank-accounts/verify']) expect(hidesNav(p), p).toBe(true);
    expect(hidesNav('/seller/payout')).toBe(false);
  });

  it('聊聊對話頁有輸入列與鍵盤，導覽隱藏；聊聊列表頁與從訂單進的新對話頁（也是對話頁）照規則', () => {
    expect(hidesNav('/seller/chat/c1')).toBe(true);
    expect(hidesNav('/seller/chat/new')).toBe(true);
    expect(hidesNav('/seller/chat')).toBe(false);
  });

  it('物流設定列表本身與其他賣家頁都有導覽', () => {
    expect(hidesNav('/seller/logistics')).toBe(false);
    expect(hidesNav('/seller')).toBe(false);
    expect(hidesNav('/seller/products/new')).toBe(false);
    expect(hidesNav('/seller/orders')).toBe(false);
  });
});

describe('isChatThreadPath：賣家聊聊的對話頁（手機版隱藏賣家頂欄、版面無內距）', () => {
  it('對話頁與從訂單進的新對話頁是，列表頁與其他賣家頁不是', () => {
    expect(isChatThreadPath('/seller/chat/c1')).toBe(true);
    expect(isChatThreadPath('/seller/chat/new')).toBe(true);
    expect(isChatThreadPath('/seller/chat')).toBe(false);
    expect(isChatThreadPath('/seller/chatter')).toBe(false);
    expect(isChatThreadPath('/seller/orders')).toBe(false);
    expect(isChatThreadPath('/chat/c1')).toBe(false);
  });
});

describe('hasSaveTray：哪些賣家頁底部有儲存托盤', () => {
  it('新增與編輯商品有', () => {
    expect(hasSaveTray('/seller/products/new')).toBe(true);
    expect(hasSaveTray('/seller/products/p123/edit')).toBe(true);
  });

  it('商品列表、匯入精靈、其他頁沒有', () => {
    expect(hasSaveTray('/seller/products')).toBe(false);
    expect(hasSaveTray('/seller/products/import')).toBe(false);
    expect(hasSaveTray('/seller')).toBe(false);
    expect(hasSaveTray('/seller/orders')).toBe(false);
  });
});

describe('sellerTabRoutes：5 個分頁的導覽目標與選中', () => {
  const at = (pathname: string) => Object.fromEntries(sellerTabRoutes(pathname).map(t => [t.key, t]));

  it('固定 5 格，順序是總覽、聊聊、商品、新增、訂單（使用者定版，評價管理退出底欄）', () => {
    expect(sellerTabRoutes('/seller').map(t => t.key)).toEqual(['overview', 'chat', 'products', 'new', 'orders']);
  });

  it('聊聊格的目的地是 /seller/chat；在對話頁時代為選中', () => {
    expect(at('/seller/chat').chat).toMatchObject({ to: '/seller/chat', goTo: '/seller/chat' });
    expect(at('/seller/chat/c1').chat).toMatchObject({ to: '/seller/chat/c1', goTo: '/seller/chat' });
    expect(at('/seller/chat/new').chat).toMatchObject({ to: '/seller/chat/new', goTo: '/seller/chat' });
  });

  it('評價管理頁 /seller/reviews：底欄亮「總覽」（它的入口在總覽），點下去回總覽（規格 §12.1）', () => {
    const tabs = at('/seller/reviews');
    expect(tabs.overview).toMatchObject({ to: '/seller/reviews', goTo: '/seller' });
    expect(tabs.orders.to).toBe('/seller/orders');
    expect(tabs.chat.to).toBe('/seller/chat');
  });

  it('一般頁面：to 就是自己的路徑，不需要攔截', () => {
    const tabs = at('/seller/orders');
    expect(tabs.orders).toMatchObject({ to: '/seller/orders', goTo: '/seller/orders' });
    expect(tabs.overview.goTo).toBe('/seller');
  });

  it('匯入精靈：「我的商品」代為選中（to 換成目前路徑），點下去仍回商品列表', () => {
    const tabs = at('/seller/products/import');
    expect(tabs.products).toMatchObject({ to: '/seller/products/import', goTo: '/seller/products' });
    expect(tabs.new.to).toBe('/seller/products/new');
  });

  it('物流設定列表：「賣場總覽」代為選中，點下去回總覽', () => {
    const tabs = at('/seller/logistics');
    expect(tabs.overview).toMatchObject({ to: '/seller/logistics', goTo: '/seller' });
  });

  it('銀行帳號頁（含它的子頁）：「賣場總覽」代為選中，點下去回總覽（AC-32）', () => {
    for (const p of ['/seller/payout', '/seller/payout/bank-accounts/new']) {
      expect(at(p).overview, p).toMatchObject({ to: p, goTo: '/seller' });
    }
    expect(at('/seller/payout').orders.to).toBe('/seller/orders');
  });

  it('編輯商品頁沒有任何分頁代選中', () => {
    const tabs = sellerTabRoutes('/seller/products/p1/edit');
    expect(tabs.every(t => t.to === t.goTo)).toBe(true);
  });
});

describe('hasOwnBackHeader／showsHomeButton：哪些頁不顯示左上「‹ 首頁」（C2＝a）', () => {
  it('物流兩張表單、收款帳戶頁自己有 SubHeader 返回', () => {
    for (const p of ['/seller/logistics/stores/new', '/seller/logistics/stores/s1', '/seller/logistics/address', '/seller/payout']) {
      expect(hasOwnBackHeader(p)).toBe(true);
      expect(showsHomeButton(p, 'bottom')).toBe(false);
    }
  });

  it('其餘賣家頁（總覽、商品、新增、編輯、匯入、訂單、評價、物流列表、聊聊）一般姿態都顯示', () => {
    for (const p of ['/seller', '/seller/products', '/seller/products/new', '/seller/products/p1/edit', '/seller/products/import', '/seller/orders', '/seller/reviews', '/seller/logistics', '/seller/chat', '/seller/chat/c1']) {
      expect(hasOwnBackHeader(p)).toBe(false);
      expect(showsHomeButton(p, 'bottom')).toBe(true);
    }
  });

  it('側邊姿態（外蓋、展開橫向、書本）任何頁都不顯示：直立軌已有「回到買家首頁」（X5）', () => {
    expect(showsHomeButton('/seller', 'side-right')).toBe(false);
    expect(showsHomeButton('/seller/orders', 'side-left')).toBe(false);
  });

  it('只比對路徑段，不會誤傷 /seller/payoutx 或 /seller/logistics', () => {
    expect(hasOwnBackHeader('/seller/payoutx')).toBe(false);
    expect(hasOwnBackHeader('/seller/logistics')).toBe(false);
  });
});

describe('homeButtonCompact：左鈕連「⋯」都放不下才縮成只有「‹」的圓鈕', () => {
  it('390 寬（列寬 358）與 188 寬（列寬 156）一般字級都不縮', () => {
    expect(homeButtonCompact(358, 78)).toBe(false);
    expect(homeButtonCompact(156, 78)).toBe(false);
  });
  it('文字 200%（左鈕 112）在 188 寬放不下：縮成圓鈕', () => {
    expect(homeButtonCompact(156, 112)).toBe(true);
  });
  it('剛好放得下（左鈕＋間距 8＋「⋯」44）不縮', () => {
    expect(homeButtonCompact(78 + 8 + 44, 78)).toBe(false);
    expect(homeButtonCompact(78 + 8 + 44 - 1, 78)).toBe(true);
  });
  it('還沒量到（Infinity）不縮', () => {
    expect(homeButtonCompact(Number.POSITIVE_INFINITY, 0)).toBe(false);
  });
});

describe('shouldShellInset：App 殼只補沒有賣家外框的賣家頁（AC-H9）', () => {
  it('賣家登入頁（沒有外框）→ 殼推 body', () => {
    expect(needsShellInset('#/seller', false)).toBe(true);
  });
  it('賣家外框在（頂欄拿掉後不再有 header.sticky，也不能誤判）→ 不推', () => {
    expect(needsShellInset('#/seller/orders', true)).toBe(false);
    expect(needsShellInset('#/seller', true)).toBe(false);
  });
  it('非賣家路由一律不推（買家前台自己處理）', () => {
    expect(needsShellInset('#/account', false)).toBe(false);
    expect(needsShellInset('#/sellerx', false)).toBe(false);
  });
});

describe('subPageOwnsPadding：收款帳戶頁 main 不留左右內距（B4）', () => {
  it('只有收款帳戶頁', () => {
    expect(subPageOwnsPadding('/seller/payout')).toBe(true);
    expect(subPageOwnsPadding('/seller/logistics/address')).toBe(false);
    expect(subPageOwnsPadding('/seller/orders')).toBe(false);
  });
});
