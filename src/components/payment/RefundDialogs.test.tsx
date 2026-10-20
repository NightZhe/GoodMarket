import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AcceptCancelDialog, RejectCancelDialog, RequestCancelDialog, SellerCancelDialog, WithdrawCancelDialog } from './RefundDialogs';
import { CardInline, SellerBadgeView, StatusBlockView } from './RefundBlocks';

// 文字取自 .work/account-payment-methods/design-refund.md §4.4、§5.4；無障礙取自 §7。
// 互動（焦點移到標題、Esc、Tab 循環、離線）在瀏覽器裡驗（a4-shots／驗證紀錄），這裡只驗 markup。
const card = { brand: 'visa' as const, card6: '424242', card4: '4242' };
const text = (html: string) => html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ');
const noop = async () => null;

beforeEach(() => { vi.stubGlobal('navigator', { onLine: true }); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('D-B1 申請取消對話框', () => {
  const html = (siblings: boolean) => renderToStaticMarkup(<RequestCancelDialog total={1234} card={card} hasSiblings={siblings} onClose={() => {}} onSubmit={noop} />);
  it('逐字：標題、三段內文、原因選項、兩顆按鈕', () => {
    const t = text(html(false));
    expect(t).toContain('申請取消這筆訂單？');
    expect(t).toContain('賣家同意後，訂單會取消且無法復原，全額 $1,234 會退回 Visa •••• 末四碼 4242。');
    expect(t).toContain('賣家回應前不會出貨。賣家在 48 小時內沒有回應，會自動取消並退款。');
    expect(t).toContain('每張訂單只能申請一次：送出後，即使撤回或被賣家拒絕，都不能再申請。');
    for (const l of ['取消原因（必選）', '不想買了', '想更換商品或規格', '重複下單', '賣家太久沒出貨', '其他', '先不要', '送出取消申請']) expect(t).toContain(l);
    expect(t).not.toContain('同一次付款的其他訂單不受影響');
  });
  it('同批付款還有其他訂單才多一句', () => {
    expect(text(html(true))).toContain('同一次付款的其他訂單不受影響。');
  });
  it('無障礙：role=dialog＋aria-modal＋aria-labelledby 指向可程式聚焦的標題；原因是原生單選；每列 ≥44px；選「其他」前沒有輸入框', () => {
    const h = html(false);
    expect(h).toMatch(/role="dialog"[^>]*aria-modal="true"[^>]*aria-labelledby="([^"]+)"/);
    const id = h.match(/aria-labelledby="([^"]+)"/)![1];
    expect(h).toContain(`<h2 id="${id}" tabindex="-1"`);
    expect(h).toContain('<legend');
    expect(h.match(/type="radio"/g)).toHaveLength(5);
    expect(h.match(/min-h-11/g)!.length).toBeGreaterThanOrEqual(7);
    expect(h).not.toContain('<textarea');
  });
  it('卡別讀不到：整段寫「你付款的信用卡」', () => {
    const h = renderToStaticMarkup(<RequestCancelDialog total={690} card={null} hasSiblings={false} onClose={() => {}} onSubmit={noop} />);
    expect(text(h)).toContain('全額 $690 會退回你付款的信用卡。');
  });
  it('按鈕列釘底、內文自己捲（小螢幕、200% 字級）', () => {
    const h = html(false);
    expect(h).toContain('max-h-[calc(90dvh-2rem)]');
    expect(h).toContain('overflow-y-auto');
    expect(h).toContain('shrink-0');
  });
});

describe('D-S2 拒絕對話框', () => {
  const h = renderToStaticMarkup(<RejectCancelDialog onClose={() => {}} onSubmit={noop} />);
  it('逐字', () => {
    const t = text(h);
    for (const l of ['拒絕取消申請？', '訂單會照常待出貨，需要你出貨。買家每張訂單只能申請一次，被拒絕後不能再申請。', '拒絕原因（必填，最多 100 字，買家看得到）', '0/100', '先不要', '送出拒絕']) expect(t).toContain(l);
    expect(h).toContain('placeholder="例如：商品已經打包，今天會寄出。"');
  });
  it('textarea 字級 16px（text-base）、最多 100 字、有 label', () => {
    expect(h).toMatch(/<textarea[^>]*maxLength="100"/);
    expect(h).toMatch(/<textarea[^>]*class="[^"]*text-base/);
    const id = h.match(/<label for="([^"]+)"/)![1];
    expect(h).toContain(`<textarea id="${id}"`);
  });
});

describe('D-S3 取消並退款對話框', () => {
  const h = renderToStaticMarkup(<SellerCancelDialog total={1234} onClose={() => {}} onSubmit={noop} />);
  it('逐字；賣家四個原因；H-RF3 確認前不出現帳戶餘額那句', () => {
    const t = text(h);
    expect(t).toContain('取消並退款？');
    expect(t).toContain('取消後，全額 $1,234（含運費）會退款給買家，這張訂單變成已取消，商品庫存會退回。無法復原。');
    expect(t).toContain('買家看得到你選的取消原因。好物集會向綠界科技辦理退款，不需要你到綠界後台操作。');
    for (const l of ['缺貨或無法出貨', '買家要求取消', '價格或商品資訊有誤', '其他', '保留訂單']) expect(t).toContain(l);
    expect(t).not.toMatch(/餘額|撥款/);
  });
});

describe('純確認對話框（沿用 LeaveDialog）', () => {
  it('D-B2 撤回申請：逐字，安全選項＝保留申請', () => {
    const t = text(renderToStaticMarkup(<WithdrawCancelDialog onStay={() => {}} onConfirm={async () => {}} />));
    for (const l of ['撤回取消申請？', '撤回後，訂單照常出貨。每張訂單只能申請一次，撤回後這筆訂單不能再申請取消。', '保留申請', '撤回申請']) expect(t).toContain(l);
  });
  it('D-S1 同意取消並退款：逐字；H-RF3 預留句不出現', () => {
    const h = renderToStaticMarkup(<AcceptCancelDialog total={1234} reason="other" note="太貴" onStay={() => {}} onConfirm={async () => {}} />);
    const t = text(h);
    expect(t).toContain('同意取消並退款？');
    expect(t).toContain('買家申請取消，原因：其他（太貴）。');
    expect(t).toContain('同意後，全額 $1,234（含運費）會退款給買家，這張訂單變成已取消，商品庫存會退回。無法復原。');
    expect(t).toContain('好物集會向綠界科技辦理退款，不需要你到綠界後台操作。');
    expect(t).not.toContain('餘額');
    expect(h).toContain('role="alertdialog"');
  });
  it('離線：說明用 role=status，且只有 leave 鈕 aria-disabled（安全選項永遠能按）', () => {
    vi.stubGlobal('navigator', { onLine: false });
    const h = renderToStaticMarkup(<AcceptCancelDialog total={1} reason="other" note={null} onStay={() => {}} onConfirm={async () => {}} />);
    expect(h).toContain('<p role="status" class="mt-4 text-sm text-muted">目前沒有網路連線，連上網路後才能操作。</p>');
    expect(h.match(/aria-disabled="true"/g)).toHaveLength(1);
  });
});

describe('狀態區塊與徽章', () => {
  const block = { tone: 'info' as const, title: '退款處理中', lines: [['全額 $1 會退回 ', { card: true as const }, '。'], ['如有疑問請聯絡我們：', { mail: true as const }]] };
  it('買家區塊：可程式聚焦（tabindex=-1）、不是 live region、圖示 aria-hidden、卡別末四碼給讀屏、信箱連結 ≥44px', () => {
    const h = renderToStaticMarkup(<StatusBlockView block={block} variant="buyer" id="refund-status-1" card={card} />);
    expect(h).toContain('id="refund-status-1"');
    expect(h).toContain('tabindex="-1"');
    expect(h).not.toMatch(/role="(status|alert)"|aria-live/);
    expect(h).toMatch(/<svg[^>]*aria-hidden="true"/);
    expect(h).toContain('<span aria-hidden="true">•••• </span><span class="sr-only">末四碼 </span>4242');
    expect(h).toMatch(/<a href="mailto:[^"]+" class="[^"]*min-h-11/);
    expect(h).toContain('text-ink');
  });
  it('賣家區塊：區塊內可放按鈕列（children）', () => {
    const h = renderToStaticMarkup(<StatusBlockView block={{ ...block, tone: 'warning' }} variant="seller" id="x" card={null}><button>拒絕</button></StatusBlockView>);
    expect(h).toContain('border-warning-border bg-warning-bg');
    expect(h).toContain('<button>拒絕</button>');
  });
  it('卡別讀不到時不畫卡別', () => {
    const h = renderToStaticMarkup(<StatusBlockView block={block} variant="buyer" id="x" card={null} />);
    expect(h).not.toContain('4242');
  });
  it('CardInline：卡別與末四碼之間有空白（行文中）', () => {
    expect(text(renderToStaticMarkup(<CardInline card={card} />))).toBe('Visa •••• 末四碼 4242');
  });
  it('賣家徽章：文字一律在、圖示 aria-hidden', () => {
    const h = renderToStaticMarkup(<SellerBadgeView kind="requested" />);
    expect(text(h)).toBe('買家申請取消');
    expect(h).toMatch(/<svg[^>]*aria-hidden="true"/);
  });
});
