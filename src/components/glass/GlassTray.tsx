import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router-dom';

type TrayProps = {
  /** 托盤的名稱（VoiceOver 唸）：「購買」「結帳」「儲存」 */
  label: string;
  /**
   * actions＝購買／儲存：兩顆按鈕，hug 寬（兩顆 272）。放不下（文字放大）時按鈕上下排。
   * checkout＝結帳：[全選][總金額][去買單] 三樣東西，吃欄寬、上限 340。內部版面由呼叫端用 children 排（grid 三欄：auto 1fr auto）
   */
  variant?: 'actions' | 'checkout';
  /** 疊在 TabPill 正上方（間距 8）：賣家新增商品直向。內容底部預留改用 var(--stack-clearance)（192） */
  abovePill?: boolean;
  children: ReactNode;
};

/**
 * 懸浮玻璃托盤（design-spec §4.3）：購買列、結帳列、儲存列。置中在內容欄（吃 --inset-l／--inset-r，所以側邊姿態自動讓開軌），
 * 下緣 var(--tp-bottom)，固定在底部不隨捲動。內容底部要預留 var(--tray-clearance)（122）。z-40，在 sheet／modal 之下。
 * 半折：托盤落在哪一半由外層決定（T3／T4／T8），元件本身不偵測姿態。
 */
export function GlassTray({ label, variant = 'actions', abovePill = false, children }: TrayProps) {
  const cls = `glass glass-tray ${variant === 'checkout' ? 'glass-tray--checkout' : ''} ${abovePill ? 'glass-tray--above-pill' : ''}`;
  return <div role="group" aria-label={label} className={cls}>{children}</div>;
}

type ButtonBase = {
  /** primary＝brand 實心＋白字（主要動作）；secondary＝淡橘底＋brand 字（次要）。兩顆同高同圓角，主次靠實心與淡底分，不靠大小 */
  tone: 'primary' | 'secondary';
  children: ReactNode;
};

type TrayButtonProps = ButtonBase & (
  | ({ to: string } & Pick<LinkProps, 'onClick' | 'replace' | 'state'> & { disabled?: never; type?: never })
  | ({ to?: undefined } & Pick<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick' | 'disabled' | 'type' | 'form' | 'aria-busy' | 'aria-disabled'>)
);

const TONE = {
  primary: 'bg-brand text-white active:bg-brand-dark disabled:bg-canvas disabled:text-muted-2',
  secondary: 'bg-tab-sel text-brand active:bg-tab-sel-press active:text-brand-dark disabled:bg-canvas disabled:text-muted-2',
} as const;

/** 托盤裡的按鈕：高 44、圓角 22（與托盤外圓 32 − 內距 10 同心）、最小寬 120、16／600。有 `to` 是連結，否則是 button */
export function TrayButton({ tone, children, ...rest }: TrayButtonProps) {
  const cls = `tray-btn text-callout font-semibold ${TONE[tone]}`;
  if ('to' in rest && rest.to !== undefined) {
    const { to, onClick, replace, state } = rest;
    return <Link to={to} onClick={onClick} replace={replace} state={state} className={cls}>{children}</Link>;
  }
  const { disabled, type = 'button', onClick, form, ...aria } = rest;
  return <button type={type} form={form} disabled={disabled} onClick={onClick} {...aria} className={cls}>{children}</button>;
}
