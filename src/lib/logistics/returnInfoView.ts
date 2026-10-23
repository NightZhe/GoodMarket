import { composeAddress, formatPhone } from '../account/address';
import { brandLabel } from './brands';

// 買家「我的訂單」上的退貨資訊：資料形狀與顯示組合（設計 6.2～6.3、spec 8.2）。純函式，L-A2 的畫面元件直接用。

/** get_order_return_info 的 store（只會是預設門市；不含 id、店名、時間） */
export interface ReturnInfoStore {
  brand: string;
  store_name: string;
  recipient: string;
  phone: string;
  city: string;
  district: string;
  postal_code: string;
  detail: string;
}

export interface ReturnInfoPersonal {
  recipient: string;
  phone: string;
  city: string;
  district: string;
  postal_code: string;
  detail: string;
}

/** 三個 key 一定都在；沒有就是 null。三者都 null＝賣家什麼都沒設 */
export interface ReturnInfo {
  store: ReturnInfoStore | null;
  personal: ReturnInfoPersonal | null;
  note: string | null;
}

export interface ReturnInfoRow { label: string; value: string; strong: boolean }

export interface ReturnInfoSection {
  kind: 'store' | 'personal';
  /** 段落標題（h3）：超商退貨／宅配退貨 */
  title: string;
  rows: ReturnInfoRow[];
  /** 「複製」鈕的 aria-label */
  copyLabel: string;
  /** 複製進剪貼簿的純文字（含欄名，換行分隔） */
  copyText: string;
}

export interface ReturnInfoView {
  /** 超商在前、宅配在後；只出現賣家有設的 */
  sections: ReturnInfoSection[];
  /** 兩種地址都沒有（退貨說明可能仍有） */
  empty: boolean;
  emptyText: string;
  /** 純文字、保留換行；沒有或只有空白＝null */
  note: string | null;
  legalText: string;
}

// 以下三句是使用者確認過的字句（spec 10.2、10.3），一字不改。
export const RETURN_EMPTY_TEXT = '賣家尚未提供退貨地址';
export const LEGAL_NOTICE = '收到商品後 7 天內，可以向賣家提出退貨（消費者保護法第 19 條；部分商品依法除外）。';

const section = (kind: ReturnInfoSection['kind'], title: string, copyLabel: string, rows: ReturnInfoRow[]): ReturnInfoSection => ({
  kind, title, rows, copyLabel,
  copyText: [title, ...rows.map(r => `${r.label}：${r.value}`)].join('\n'),
});

const lineOf = (a: Pick<ReturnInfoStore, 'postal_code' | 'city' | 'district' | 'detail'>) =>
  composeAddress({ zip: a.postal_code, city: a.city, district: a.district, detail: a.detail });

export function buildReturnInfoView(info: ReturnInfo): ReturnInfoView {
  const sections: ReturnInfoSection[] = [];
  if (info.store) {
    const s = info.store;
    sections.push(section('store', '超商退貨', '複製超商退貨資料', [
      { label: '門市', value: `${brandLabel(s.brand)} ${s.store_name}`, strong: true },
      { label: '地址', value: lineOf(s), strong: false },
      { label: '收件人', value: s.recipient, strong: true },
      { label: '手機', value: formatPhone(s.phone), strong: false },
    ]));
  }
  if (info.personal) {
    const p = info.personal;
    sections.push(section('personal', '宅配退貨', '複製宅配退貨資料', [
      { label: '收件人', value: p.recipient, strong: true },
      { label: '手機', value: formatPhone(p.phone), strong: false },
      { label: '地址', value: lineOf(p), strong: false },
    ]));
  }
  return {
    sections,
    empty: sections.length === 0,
    emptyText: RETURN_EMPTY_TEXT,
    note: info.note !== null && info.note.trim() !== '' ? info.note : null,
    legalText: LEGAL_NOTICE,
  };
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** RPC 回傳 → 固定形狀；缺的或型別不對當作沒有（讀取失敗另外處理，不會走到這裡） */
export function parseReturnInfo(raw: unknown): ReturnInfo {
  const o = isRecord(raw) ? raw : {};
  return {
    store: isRecord(o.store) ? (o.store as unknown as ReturnInfoStore) : null,
    personal: isRecord(o.personal) ? (o.personal as unknown as ReturnInfoPersonal) : null,
    note: typeof o.note === 'string' ? o.note : null,
  };
}
