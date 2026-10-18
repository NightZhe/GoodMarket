import { useCallback, useState } from 'react';
import { clearFlow, flowStore, loadFlow, type PhoneFlow } from '../../lib/auth/phoneFlow';

/**
 * 登入畫面（面板、閘門、賣家中心、綁定頁）現在在哪一步：flow＝null 是輸入手機號碼的主畫面，有值就是 S-10。
 * 一開始從 R-25 保存的狀態還原（重新整理、從簡訊 App 切回來頁面被重新載入）。
 * back＝「改用其他號碼」／返回：清掉保存的狀態，回主畫面並帶回原號碼。
 */
export function usePhoneStep(mode: 'login' | 'bind') {
  const [flow, setFlow] = useState<PhoneFlow | null>(() => {
    const f = loadFlow(flowStore(), Date.now());
    return f && f.step === mode ? f : null;
  });
  const [lastPhone, setLastPhone] = useState<string | undefined>(undefined);
  const back = useCallback(() => {
    setFlow(cur => { if (cur) setLastPhone(cur.phone); return null; });
    clearFlow(flowStore());
  }, []);
  return { flow, lastPhone, enter: setFlow, back };
}
