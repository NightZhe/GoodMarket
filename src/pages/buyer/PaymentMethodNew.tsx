import { useCallback, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import LoginRequired from '../../components/auth/LoginRequired';
import Banner from '../../components/import/Banner';
import { btnOutline } from '../../components/import/ui';
import { SubHeader, SubPage } from '../../components/account/ui';
import BindCardPanel from '../../components/payment/BindCardPanel';
import { useAuth } from '../../store/AuthContext';
import { detectInApp, inAppName } from '../../lib/auth/inapp';
import { CARD_LIMIT } from '../../lib/payment/limits';
import { usePaymentConfig } from '../../lib/payment/usePaymentConfig';

/** 綁卡完成、失敗或結果不明後都到這一頁看結果（以伺服器查詢為準）。後端會在後面接 ?bind=…&no=…，所以路徑本身不能有 ? */
export const BIND_RETURN_PATH = '/account/payment-methods/result';

/** 新增信用卡 #/account/payment-methods/new（S-3）。sticky：登入過期時頁面不被換掉，改開登入面板蓋在上面 */
export default function PaymentMethodNew() {
  return (
    <LoginRequired kind="account" sticky>
      <NewView />
    </LoginRequired>
  );
}

function NewView() {
  const navigate = useNavigate();
  const { openLogin } = useAuth();
  const { enabled, ready } = usePaymentConfig();
  const [blocked, setBlocked] = useState<'CARD_LIMIT' | 'PAYMENT_DISABLED' | null>(null);
  const inApp = detectInApp(navigator.userAgent);

  const toResult = useCallback((no: string, hint: 'bound' | 'failed' | 'confirming') => {
    navigate(`${BIND_RETURN_PATH}?bind=${hint}&no=${encodeURIComponent(no)}`, { replace: true });
  }, [navigate]);

  const back = '/account/payment-methods';
  const disabled = (ready && !enabled) || blocked === 'PAYMENT_DISABLED';

  return (
    <SubPage noTabBar>
      <SubHeader to={back} backLabel="回到付款方式" backText="付款方式" title="新增信用卡" />

      {disabled && (
        <Notice>
          <Banner kind="info" role="status" title="線上付款暫時停用" actions={<Link to={back} className={btnOutline}>回到付款方式</Link>}>
            目前不能綁定信用卡。恢復後會在這裡開放。
          </Banner>
        </Notice>
      )}

      {blocked === 'CARD_LIMIT' && (
        <Notice>
          <Banner kind="warning" role="status" title={`已經綁了 ${CARD_LIMIT} 張卡`} actions={<Link to={back} className={btnOutline}>回到付款方式</Link>}>
            最多只能綁 {CARD_LIMIT} 張，正在刪除中的卡也算在內。請先刪除一張，或等刪除中的卡處理完再新增。
          </Banner>
        </Notice>
      )}

      {!disabled && blocked === null && (
        <>
          <section className="mt-2 bg-white p-4 md:mt-3 rounded-card md:p-6">
            <h2 className="text-sm font-bold">綁定前先知道</h2>
            <ul className="mt-2 space-y-2 text-sm">
              <li><span className="font-medium">先授權一小筆金額，再立刻退刷</span>　用來驗證卡片，不會真的收費。帳單上可能短暫看到這筆授權。</li>
              <li><span className="font-medium">可能需要 3D 驗證</span>　銀行可能要求簡訊驗證碼或 App 確認，會暫時離開好物集，完成後自動回來。</li>
              <li><span className="font-medium">卡號由綠界科技保管</span>　下方欄位是綠界科技的畫面，卡號不會經過好物集。</li>
            </ul>
          </section>

          {inApp && (
            <div className="mt-2 md:mt-3">
              <Banner kind="info" role="status" title={`你正在 ${inAppName(inApp)} 裡開啟好物集`}>
                如果驗證完成後沒有自動回到這一頁，請回到好物集，到「付款方式」查看結果。
              </Banner>
            </div>
          )}

          <section className="mt-2 bg-white p-4 md:mt-3 rounded-card md:p-6">
            <h2 className="mb-3 text-sm font-bold">卡片資料</h2>
            <BindCardPanel
              variant="page" returnPath={BIND_RETURN_PATH} from="page"
              onBound={({ no }) => toResult(no, 'bound')}
              onResult={(no, hint) => toResult(no, hint)}
              onAuthLost={() => openLogin({ expired: true, trigger: { kind: 'goto' } })}
              onCancel={() => navigate(back)}
              onBlocked={setBlocked}
            />
          </section>
        </>
      )}
    </SubPage>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return <div className="mt-2 bg-white p-4 md:mt-3 rounded-card md:p-6">{children}</div>;
}
