import LoginRequired from '../../components/auth/LoginRequired';
import PayoutAccountPage from '../../components/payment/PayoutAccountPage';

/** 收款帳戶（帳號頁入口）#/account/payout。沒有開店的帳號看到「你還沒有開店」 */
export default function AccountPayout() {
  return (
    <LoginRequired kind="account">
      <PayoutAccountPage backTo="/account" backLabel="回到我的帳號" />
    </LoginRequired>
  );
}
