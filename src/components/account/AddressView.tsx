import type { ReactNode } from 'react';
import { addressLine, phoneText, type AddressRow } from '../../lib/account/addresses';
import { composeAddress, formatPhone } from '../../lib/account/address';
import type { CheckoutAddress } from '../../lib/auth/pending';

/** 「預設」標籤：文字不只靠綠色 */
export function DefaultTag() {
  return <span className="inline-flex shrink-0 items-center rounded-sm bg-success-soft px-1.5 py-0.5 text-xs font-medium text-success-text">預設</span>;
}

interface Props {
  name: string;
  /** 已格式化的電話 */
  phone: string;
  line: string;
  isDefault: boolean;
  /** 抽屜單選列在 brand-soft 底上，灰色電話只有 4.41:1，改用 ink */
  phoneInk?: boolean;
}

/** 姓名＋電話＋預設標籤＋完整地址。S-13 的列、抽屜單選列、結帳摘要共用，朗讀順序＝畫面順序 */
export function AddressSummary({ name, phone, line, isDefault, phoneInk = false }: Props) {
  return (
    <>
      <span className="flex items-start justify-between gap-3">
        <span className="flex min-w-0 flex-wrap items-baseline gap-x-3 text-base font-medium">
          <span className="break-words">{name}</span>
          <span className={`whitespace-nowrap text-sm font-normal ${phoneInk ? 'text-ink' : 'text-muted'}`}>{phone}</span>
        </span>
        {isDefault && <DefaultTag />}
      </span>
      <span className="mt-1 block text-sm leading-6">{line}</span>
    </>
  );
}

export const rowSummary = (a: AddressRow, phoneInk = false): ReactNode => (
  <AddressSummary name={a.recipient} phone={phoneText(a)} line={addressLine(a)} isDefault={a.is_default} phoneInk={phoneInk} />
);

/** 結帳頁摘要：快照（結構化欄位）→ 顯示用文字 */
export const snapshotLine = (a: Pick<CheckoutAddress, 'zip' | 'city' | 'district' | 'detail'>): string => composeAddress(a);
export const snapshotPhone = (a: Pick<CheckoutAddress, 'phone'>): string => formatPhone(a.phone);
