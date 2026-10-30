import { describe, expect, it } from 'vitest';
import { parsePaymentConfig } from './api';

// PR-乙 AC-61：get_payment_config 多了兩欄；舊資料庫只回 onlinePaymentEnabled 時前端要降級成「平台收款關、時間 null」
describe('parsePaymentConfig', () => {
  it('新資料庫：三欄照收', () => {
    expect(parsePaymentConfig({ onlinePaymentEnabled: true, platformCollectEnabled: true, platformCollectEnabledAt: '2026-11-01T02:00:00+00:00' }))
      .toEqual({ onlinePaymentEnabled: true, platformCollectEnabled: true, platformCollectEnabledAt: '2026-11-01T02:00:00+00:00' });
  });
  it('舊資料庫（只有 onlinePaymentEnabled）：平台收款當關、時間 null', () => {
    expect(parsePaymentConfig({ onlinePaymentEnabled: true })).toEqual({ onlinePaymentEnabled: true, platformCollectEnabled: false, platformCollectEnabledAt: null });
  });
  it('關著但曾開過：時間保留（E6），前端照 enabled 判斷不看時間', () => {
    expect(parsePaymentConfig({ onlinePaymentEnabled: true, platformCollectEnabled: false, platformCollectEnabledAt: '2026-11-01T02:00:00+00:00' }).platformCollectEnabled).toBe(false);
  });
  it.each([null, undefined, 'x', 42, { onlinePaymentEnabled: 'true', platformCollectEnabled: 1, platformCollectEnabledAt: 5 }])('壞輸入 %j → 全關、時間 null', (v) => {
    expect(parsePaymentConfig(v)).toEqual({ onlinePaymentEnabled: false, platformCollectEnabled: false, platformCollectEnabledAt: null });
  });
});
