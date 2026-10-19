import PayoutAccountPage from '../../components/payment/PayoutAccountPage';

/** 收款帳戶（賣家中心入口）#/seller/payout。與帳號頁入口是同一個元件（D8＝C） */
export default function SellerPayout() {
  return <PayoutAccountPage backTo="/seller" backLabel="回到賣場總覽" />;
}
