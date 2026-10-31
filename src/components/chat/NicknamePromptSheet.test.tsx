import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import NicknamePromptSheet from './NicknamePromptSheet';

const noop = () => undefined;
const html = () => renderToStaticMarkup(<NicknamePromptSheet onSaved={noop} onSkip={noop} />);

describe('顯示名稱邀請面板（D11、spec B5）', () => {
  it('標題、說明、輸入框、儲存與略過都在；是 dialog 且有 aria-describedby', () => {
    const h = html();
    expect(h).toContain('設個顯示名稱，賣家才認得你');
    expect(h).toContain('賣家在聊聊會看到這個名稱；評價頁會遮罩。');
    expect(h).toContain('<input');
    expect(h).toContain('>儲存<');
    expect(h).toContain('>略過<');
    expect(h).toContain('role="dialog"');
    expect(h).toContain('aria-describedby=');
  });
  it('一開始輸入是空的：儲存鈕是 aria-disabled，略過可以按', () => {
    const h = html();
    expect(h).toMatch(/<button type="submit" aria-disabled="true"/);
    expect(h).toMatch(/<button type="button"[^>]*>略過<\/button>/);
    expect(h).not.toMatch(/<button type="button" aria-disabled="true"[^>]*>略過/);
  });
});
