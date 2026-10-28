import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { PayoutCardView } from './PayoutCard';
import PayoutBadge from './PayoutBadge';
import { PayoutChip, StatusChip } from './BankStatusChips';

const card = (s: Parameters<typeof PayoutCardView>[0]['state']) => renderToStaticMarkup(<MemoryRouter><PayoutCardView state={s} /></MemoryRouter>);

describe('PayoutCard：賣場總覽看撥款帳號狀態（AC-33）', () => {
  it('尚未設定：提示卡，連到銀行帳號頁', () => {
    const h = card('none');
    expect(h).toContain('還沒有銀行帳號');
    expect(h).toContain('新增後，之後撥款會匯到這裡。');
    expect(h).toContain('href="/seller/payout"');
  });
  it('待驗證、已驗證：一行入口列，帶徽章', () => {
    expect(card('pending')).toContain('待驗證');
    expect(card('verified')).toContain('已驗證');
    expect(card('verified')).toContain('銀行帳號');
  });
  it('未通過：錯誤卡', () => {
    const h = card('rejected');
    expect(h).toContain('銀行帳號未通過驗證');
    expect(h).toContain('請新增正確的銀行帳號。');
  });
  it('不出現「審核中」「特約商店」「可收款」等舊字樣', () => {
    for (const s of ['none', 'pending', 'verified', 'rejected'] as const) {
      for (const w of ['審核中', '特約商店', '可收款', '收款帳戶']) expect(card(s), `${s}:${w}`).not.toContain(w);
    }
  });
});

describe('徽章與 chip：圖示加文字，不只靠顏色', () => {
  it('四個徽章都有文字與 aria-hidden 的圖示', () => {
    for (const [s, t] of [['none', '尚未設定'], ['pending', '待驗證'], ['verified', '已驗證'], ['rejected', '未通過']] as const) {
      const h = renderToStaticMarkup(<PayoutBadge state={s} />);
      expect(h).toContain(t);
      expect(h).toContain('aria-hidden="true"');
    }
  });
  it('chip：撥款帳號與三種驗證狀態', () => {
    expect(renderToStaticMarkup(<PayoutChip />)).toContain('撥款帳號');
    for (const [s, t] of [['pending', '待驗證'], ['verified', '已驗證'], ['rejected', '未通過']] as const) expect(renderToStaticMarkup(<StatusChip status={s} />)).toContain(t);
  });
});
