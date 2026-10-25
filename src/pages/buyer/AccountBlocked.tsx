import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Ban } from 'lucide-react';
import { useStore } from '../../store/StoreContext';
import { SubHeader, SubPage, textActionCls } from '../../components/account/ui';
import { useBlockActions } from '../../components/report/useBlockActions';
import { blockedDate } from '../../lib/block/format';

/**
 * 已封鎖的店家 #/account/blocked（S-K13）。不包 LoginRequired：封鎖只存在這台裝置，未登入也能管理。
 * 取消封鎖可逆，一次點擊、不二次確認。
 */
export default function AccountBlocked() {
  const { getShop, loading, loadError } = useStore();
  // 取消封鎖後焦點要跟著走（被點的那列消失了）：移到下一列的「取消封鎖」，沒有就移到空狀態標題
  const [focusAfter, setFocusAfter] = useState<{ id: string | null } | null>(null);
  const actions = useBlockActions({
    onUnblocked: gone => {
      const at = actions.shops.findIndex(s => s.id === gone.id);
      const next = actions.shops[at + 1] ?? actions.shops[at - 1] ?? null;
      setFocusAfter({ id: next?.id ?? null });
    },
  });
  const { shops } = actions;
  const emptyTitle = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (!focusAfter) return;
    if (focusAfter.id) document.getElementById(`unblock-${focusAfter.id}`)?.focus();
    else emptyTitle.current?.focus();
    setFocusAfter(null);
  }, [focusAfter, shops]);

  // 商品資料還在載入、或載入失敗時，查不到店不代表店不存在：不下「已不存在」的結論
  const storeKnown = !loading && loadError === null;

  return (
    <SubPage>
      <SubHeader to="/account" backLabel="回到我的帳號" title="已封鎖的店家" />

      {shops.length === 0 ? (
        <div className="mt-2 flex flex-col items-center rounded-card bg-white px-6 py-12 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-canvas text-muted" aria-hidden="true"><Ban size={28} /></span>
          <h2 ref={emptyTitle} tabIndex={-1} className="mt-4 text-base font-medium outline-none">你沒有封鎖任何店家</h2>
        </div>
      ) : (
        <ul aria-label="已封鎖的店家" className="mt-2 divide-y-[0.5px] divide-separator overflow-hidden rounded-card bg-white">
          {shops.map(s => {
            const live = getShop(s.id);
            const gone = storeKnown && !live;
            const date = blockedDate(s.at);
            return (
              <li key={s.id} className="flex flex-wrap items-center gap-x-3 py-2 pl-4 pr-2">
                <div className="min-w-0 flex-1 basis-32 py-1">
                  {live ? (
                    <Link to={`/shop/${s.id}`} className="block break-words text-body text-ink">{live.name}</Link>
                  ) : (
                    <span className={`block break-words text-body ${gone ? 'text-muted' : 'text-ink'}`}>{gone ? '已不存在的店家' : s.name}</span>
                  )}
                  {date && <span className="block text-footnote text-muted">封鎖於 {date}</span>}
                </div>
                <button
                  id={`unblock-${s.id}`} type="button" aria-label={`取消封鎖 ${s.name}`}
                  onClick={() => actions.unblockShop(s)}
                  className={`${textActionCls} text-brand`}
                >
                  取消封鎖
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <p className="mx-5 mt-1.5 text-footnote text-muted">封鎖只存在這台裝置。清除網站資料或換裝置後，封鎖就會消失。</p>
    </SubPage>
  );
}
