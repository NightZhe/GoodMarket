import { maskTwPhone, maskTwPhoneSpoken } from '../../lib/auth/phone';

/** 遮罩門號 0912-***-678。讀屏念「星號」很怪，可見文字對讀屏隱藏，改念「0912，中間三碼已隱藏，尾數 678」 */
export default function MaskedPhone({ national }: { national: string }) {
  return (
    <>
      <span aria-hidden="true" className="tabular-nums">{maskTwPhone(national)}</span>
      <span className="sr-only">{maskTwPhoneSpoken(national)}</span>
    </>
  );
}
