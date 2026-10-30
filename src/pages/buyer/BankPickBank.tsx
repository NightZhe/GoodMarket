import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Search, X } from 'lucide-react';
import { SubHeader, SubPage, pressCls, sectionTitleCls } from '../../components/account/ui';
import BankLogo from '../../components/payment/BankLogo';
import { useBankFlow } from './BankFlow';
import { BANKS, COMMON_BANKS, type BankRow } from '../../lib/payment/bankData';
import { filterBanks } from '../../lib/payment/bankAccount';
import { pageAPath } from '../../lib/payment/bankRoutes';

const UNSUPPORTED = '農會、漁會、信用合作社目前不支援，請改用銀行或郵局帳戶。';

/** 頁 B「選擇銀行」（設計 4）。資料在本機（銀行清單進主 bundle），離線照常可用 */
export default function BankPickBank() {
  const { origin, base, draft, setDraft, leaveToA } = useBankFlow();
  const navigate = useNavigate();
  const { state } = useLocation() as { state: { change?: boolean } | null };
  const change = state?.change === true;
  const [query, setQuery] = useState('');
  const searching = query.trim() !== '';
  const list = filterBanks(BANKS, query);

  const pick = (b: BankRow) => {
    // 換了銀行：地區保留（C 會檢查新銀行在該地區有沒有分行），分行清空
    setDraft(d => ({ ...d, bankCode: b.code, branchCode: d.bankCode === b.code ? d.branchCode : '' }));
    if (change) navigate(-1);
    else navigate(`${base}/new`, { replace: true });
  };

  return (
    <SubPage noTabBar>
      <SubHeader
        to={change ? `${base}/new` : pageAPath(origin)} backText="返回" backLabel="返回" title="選擇銀行"
        onBack={change ? undefined : e => { e.preventDefault(); leaveToA(); }}
      />

      {!searching && (
        <>
          <h2 className={sectionTitleCls}>常用銀行</h2>
          <ul className="grid grid-cols-[repeat(auto-fit,minmax(88px,1fr))] gap-2">
            {COMMON_BANKS.map(b => (
              <li key={b.code} className="flex">
                <button
                  type="button" onClick={() => pick(b)} aria-label={`${b.name}，代碼 ${b.code}`} aria-current={draft.bankCode === b.code || undefined}
                  className={`flex min-h-[104px] w-full flex-col items-center justify-center gap-1 rounded-card bg-white p-2 text-center ${pressCls}`}
                >
                  <BankLogo code={b.code} size={44} />
                  <span aria-hidden="true" className="text-subhead [overflow-wrap:anywhere]">{b.short ?? b.name}</span>
                  <span aria-hidden="true" className="text-footnote tabular-nums text-muted">{b.code}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <h2 className={sectionTitleCls}>所有銀行</h2>
      <div className="relative">
        <Search size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden="true" />
        <input
          type="search" inputMode="search" enterKeyHint="search" autoComplete="off" autoCorrect="off" spellCheck={false}
          value={query} onChange={e => setQuery(e.target.value)} aria-label="搜尋銀行名稱或代碼" placeholder="搜尋銀行"
          className="block h-11 w-full appearance-none rounded-sm bg-search pl-10 pr-11 text-base outline-none placeholder:text-muted focus-visible:outline-2 focus-visible:outline-brand [&::-webkit-search-cancel-button]:hidden"
        />
        {query !== '' && (
          <button type="button" aria-label="清除搜尋" onClick={() => setQuery('')} className="absolute right-0 top-0 flex size-11 items-center justify-center text-muted">
            <X size={18} aria-hidden="true" />
          </button>
        )}
      </div>

      {list.length === 0 ? (
        <div role="status" className="mt-3 rounded-card bg-white px-4 py-8 text-center">
          <p className="text-base font-medium [overflow-wrap:anywhere]">找不到「{query.trim()}」</p>
          <p className="mt-1 text-sm text-muted text-pretty">{UNSUPPORTED}</p>
        </div>
      ) : (
        <>
          <ul className="mt-3 divide-y-[0.5px] divide-separator overflow-hidden rounded-card bg-white">
            {list.map(b => (
              <li key={b.code}>
                <button
                  type="button" onClick={() => pick(b)} aria-label={`${b.name}，代碼 ${b.code}`} aria-current={draft.bankCode === b.code || undefined}
                  className={`flex min-h-12 w-full items-center justify-between gap-3 px-4 py-2 text-left ${pressCls}`}
                >
                  <span aria-hidden="true" className="min-w-0 text-body [overflow-wrap:anywhere]">{b.name}</span>
                  <span aria-hidden="true" className="shrink-0 text-subhead tabular-nums text-muted">{b.code}</span>
                </button>
              </li>
            ))}
          </ul>
          <p className="px-5 pt-2 text-footnote text-muted text-pretty">{UNSUPPORTED}</p>
        </>
      )}
    </SubPage>
  );
}
