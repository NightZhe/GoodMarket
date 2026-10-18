import { useState } from 'react';
import { ChevronDown, Info } from 'lucide-react';
import {
  ADDRESS_TOTAL_MAX, addressLength, detailRepeatsRegion, oneLine, selectCity,
  type AddressDraft, type AddressErrors, type AddressField,
} from '../../lib/account/address';
import { cityNames, districtsOf, zipOf } from '../../lib/account/regions';
import { FieldError, fieldCls, helpCls, labelCls } from './ui';

interface Props {
  value: AddressDraft;
  errors: AddressErrors;
  onChange: (next: AddressDraft) => void;
  onBlurField: (field: AddressField) => void;
  /** 儲存中：文字框唯讀、下拉停用 */
  busy?: boolean;
  /** 欄位 id 的前綴；同一頁只會有一組 */
  idPrefix: string;
  /** 抽屜、對話框版：只有 448px 寬，縣市／（區＋郵遞區號）兩欄，不用三欄 */
  compact?: boolean;
}

const remainText = (n: number) => (n < 0 ? `超過 ${-n} 字` : `剩 ${n} 字`);

/**
 * 地址欄位組（設計 6.1～6.2）：收件人、手機、縣市→鄉鎮市區→郵遞區號、詳細地址。
 * 個人檔案以外所有地址輸入（地址頁、結帳抽屜、結帳內嵌表單）共用這一份，規則、文案、無障礙只有一份。
 * 兩個下拉用原生 select：iPhone 的滾輪、VoiceOver、自動填入都是現成的。
 */
export default function AddressFields({ value, errors, onChange, onBlurField, busy = false, idPrefix: p, compact = false }: Props) {
  // 連動後的播報：區域永遠存在於 DOM（先渲染空的再改字），否則 iOS 不會念
  const [announce, setAnnounce] = useState('');
  const districts = districtsOf(value.city);
  const zip = zipOf(value.city, value.district) ?? '';
  const remaining = ADDRESS_TOTAL_MAX - addressLength(value);
  const set = (patch: Partial<AddressDraft>) => onChange({ ...value, ...patch });

  const describedBy = (field: AddressField, ...extra: string[]) =>
    [...extra, errors[field] ? `${p}-${field}-err` : ''].filter(Boolean).join(' ') || undefined;

  const onCity = (city: string) => {
    if (city === value.city) return;
    const hadDistrict = value.district !== '';
    onChange(selectCity(value, city));
    if (city === '') setAnnounce('');
    else if (hadDistrict) setAnnounce(`已改選 ${city}，鄉鎮市區和郵遞區號已清除，請重新選擇鄉鎮市區`);
    else setAnnounce(`鄉鎮市區可以選了，共 ${districtsOf(city).length} 個`);
  };

  const onDistrict = (district: string) => {
    set({ district });
    const z = zipOf(value.city, district);
    setAnnounce(z ? `郵遞區號 ${z}` : '');
  };

  const textRO = busy || undefined;

  return (
    <div>
      <p role="status" aria-live="polite" className="sr-only">{announce}</p>

      <div>
        <label htmlFor={`${p}-recipient`} className={labelCls}>收件人</label>
        <input
          id={`${p}-recipient`} type="text" value={value.recipient} placeholder="王小明" readOnly={textRO}
          autoComplete="name" autoCapitalize="off" autoCorrect="off" enterKeyHint="next"
          aria-invalid={errors.recipient ? true : undefined} aria-describedby={describedBy('recipient')}
          onChange={e => set({ recipient: e.target.value })} onBlur={() => onBlurField('recipient')}
          className={`mt-1 scroll-mt-20 ${fieldCls(Boolean(errors.recipient))}`}
        />
        <FieldError id={`${p}-recipient-err`}>{errors.recipient}</FieldError>
      </div>

      <div className="mt-4">
        <label htmlFor={`${p}-phone`} className={labelCls}>手機號碼</label>
        <input
          id={`${p}-phone`} type="tel" inputMode="tel" value={value.phone} placeholder="0912-345-678" readOnly={textRO}
          autoComplete="tel" enterKeyHint="next"
          aria-invalid={errors.phone ? true : undefined} aria-describedby={describedBy('phone', `${p}-phone-help`)}
          onChange={e => set({ phone: e.target.value })} onBlur={() => onBlurField('phone')}
          className={`mt-1 scroll-mt-20 ${fieldCls(Boolean(errors.phone))}`}
        />
        <p id={`${p}-phone-help`} className={helpCls}>09 開頭、10 碼，可以輸入連字號</p>
        <FieldError id={`${p}-phone-err`}>{errors.phone}</FieldError>
      </div>

      <div className={`mt-4 grid gap-4 ${compact ? '' : 'md:grid-cols-[1fr_1fr_7rem]'}`}>
        <div>
          <label htmlFor={`${p}-city`} className={labelCls}>縣市</label>
          <div className="relative mt-1">
            <select
              id={`${p}-city`} value={value.city} disabled={busy} autoComplete="address-level1"
              aria-invalid={errors.city ? true : undefined} aria-describedby={describedBy('city')}
              onChange={e => onCity(e.target.value)}
              className={`scroll-mt-20 ${fieldCls(Boolean(errors.city), 'select', value.city === '')}`}
            >
              <option value="">請選擇縣市</option>
              {cityNames().map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted"><ChevronDown size={20} aria-hidden="true" /></span>
          </div>
          <FieldError id={`${p}-city-err`}>{errors.city}</FieldError>
        </div>

        <div className={`grid gap-4 min-[360px]:grid-cols-[1fr_6.5rem] min-[360px]:gap-3 ${compact ? '' : 'md:contents'}`}>
          <div>
            <label htmlFor={`${p}-district`} className={labelCls}>鄉鎮市區</label>
            <div className="relative mt-1">
              <select
                id={`${p}-district`} value={value.district} disabled={busy || value.city === ''} autoComplete="address-level2"
                aria-invalid={errors.district ? true : undefined} aria-describedby={describedBy('district')}
                onChange={e => onDistrict(e.target.value)}
                className={`scroll-mt-20 ${fieldCls(Boolean(errors.district), 'select', value.district === '')}`}
              >
                <option value="">{value.city === '' ? '請先選縣市' : '請選擇鄉鎮市區'}</option>
                {districts.map(d => <option key={d.name} value={d.name}>{d.name}</option>)}
              </select>
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted"><ChevronDown size={20} aria-hidden="true" /></span>
            </div>
            <FieldError id={`${p}-district-err`}>{errors.district}</FieldError>
          </div>
          <div>
            <label htmlFor={`${p}-zip`} className={labelCls}>郵遞區號</label>
            <input
              id={`${p}-zip`} type="text" value={zip} placeholder="自動帶入" readOnly tabIndex={-1} aria-readonly="true"
              autoComplete="postal-code"
              className={`mt-1 ${fieldCls(false, 'zip')}`}
            />
          </div>
        </div>
      </div>

      <div className="mt-4">
        <label htmlFor={`${p}-detail`} className={labelCls}>詳細地址</label>
        <textarea
          id={`${p}-detail`} rows={3} value={value.detail} placeholder="例：忠孝東路四段1號5樓" readOnly={textRO}
          autoComplete="address-line1" enterKeyHint="done"
          aria-invalid={errors.detail ? true : undefined} aria-describedby={describedBy('detail', `${p}-detail-help`)}
          onChange={e => set({ detail: oneLine(e.target.value) })}
          onKeyDown={e => { if (e.key === 'Enter') e.preventDefault(); }}
          onBlur={() => onBlurField('detail')}
          className={`mt-1 scroll-mt-20 ${fieldCls(Boolean(errors.detail), 'textarea')}`}
        />
        <div className="mt-1 flex flex-wrap items-start justify-between gap-x-3 text-sm text-muted">
          <p id={`${p}-detail-help`} className="min-w-40 flex-1">路名、門牌、樓層。縣市和區不用再打，合計最多 {ADDRESS_TOTAL_MAX} 字。</p>
          <span aria-hidden="true" className={`shrink-0 tabular-nums ${remaining <= 10 ? 'font-medium' : ''} ${remaining < 0 ? 'text-error-text' : remaining <= 10 ? 'text-ink' : ''}`}>{remainText(remaining)}</span>
        </div>
        <FieldError id={`${p}-detail-err`}>{errors.detail}</FieldError>
        {detailRepeatsRegion(value) && (
          <p className="mt-2 flex items-start gap-1.5 text-sm">
            <Info size={16} className="mt-0.5 shrink-0 text-info-text" aria-hidden="true" />
            <span>縣市和區已經選好了，這裡填路名以後就好</span>
          </p>
        )}
      </div>
    </div>
  );
}
