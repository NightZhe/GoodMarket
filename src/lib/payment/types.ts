// 線上付款（綠界特約合作平台商，信用卡）的前後端介面型別。只有型別與常數，沒有執行期邏輯。
// 完整說明（端點、參數、錯誤碼、嵌入綠界綁卡畫面的方式、輪詢）：.work/account-payment-methods/interface-payment.md
// 後端實作：supabase/functions/payment-*（Edge Functions）與 supabase/migrations/20261019200000_ecpay_payments.sql。

/** 所有 Edge Function 的錯誤格式（HTTP 狀態碼 4xx/5xx）。成功一律是 { ok: true, ... }。 */
export interface PaymentErrorBody { ok: false; error: { code: PaymentErrorCode; message: string } }

/** message 是中文，可直接顯示；code 給程式判斷。RPC 的錯誤則是 supabase-js 的 error.hint＝code、error.message＝中文。 */
export type PaymentErrorCode =
  | 'NOT_AUTHENTICATED'          // 401 沒登入或登入過期
  | 'REQUEST_INVALID'            // 400 請求格式不正確
  | 'RETURN_PATH_INVALID'        // 400 returnPath 不是站內路徑
  | 'NO_CONTACT'                 // 400 帳號沒有 email 也沒有手機號碼，綠界不收
  | 'PAYMENT_DISABLED'           // 400/503 功能開關關著
  | 'CARD_LIMIT'                 // 409 已綁 5 張
  | 'BIND_RATE_LIMIT'            // 429 一小時內開始綁卡超過 10 次
  | 'BIND_UNAVAILABLE'           // 502 綠界暫時不可用
  | 'BIND_NOT_FOUND'             // 404 找不到這次綁卡
  | 'CARD_NOT_FOUND'             // 404 找不到這張卡（含別人的卡）
  | 'DEFAULT_CARD_CANNOT_DELETE' // 409 預設的卡在還有別張時不能刪
  | 'GROUP_NOT_FOUND'            // 404 找不到這筆付款（含別人的）
  | 'ALREADY_PAID'               // 409
  | 'PAYMENT_IN_PROGRESS'        // 409 付款處理中／確認中，請稍候或輪詢 payment-status
  | 'ORDER_EXPIRED'              // 410 待付款逾時（30 分鐘）或已取消，請重新下單
  | 'SHOP_NOT_ONLINE'            // 400 有商店目前不能線上付款
  | 'ONLINE_AMOUNT_LIMIT'        // 400 單一商店線上付款上限 200,000 元
  | 'ORDER_PAID_NO_CANCEL'       // RPC：已付款的訂單不能自行取消（退款流程另一份規格）
  | 'FORBIDDEN' | 'METHOD_NOT_ALLOWED' | 'INTERNAL';

// ── 付款方式（卡片）──
/** 讀法：supabase.from('my_payment_methods').select('*')。沒有 BindCardID，永遠沒有。 */
export interface PaymentMethodRow {
  id: string;
  card6: string;
  card4: string;
  exp_month: string;    // 'MM'
  exp_year: string;     // 'YY'
  is_default: boolean;
  created_at: string;
  brand: 'visa' | 'mastercard' | 'jcb' | 'unionpay' | 'amex' | 'other';
  expired: boolean;     // 有效期限已過：不要讓使用者選來付款
}

// ── 綁卡 ──
export interface BindStartRequest { returnPath?: string }  // 3D 驗證後導回前端的站內路徑（以 / 開頭），預設 /account/payment-methods
export interface BindStartResponse {
  ok: true;
  merchantTradeNo: string;      // 這次綁卡的編號，後面兩支函式都要帶
  token: string;                // ECPay.addBindingCard(token, ...) 用，30 分鐘內有效
  tokenExpiresAt: string;       // 'yyyy/MM/dd HH:mm:ss'（台灣時間）
  serverType: 'Stage' | 'Prod'; // ECPay.initialize(ECPay.ServerType[serverType], ...)
  sdkUrl: string;               // 要載入的綠界 JS（<script src>）；需要 jQuery 3.x 先載入
}
export interface BindConfirmRequest { merchantTradeNo: string; bindCardPayToken: string }
export type BindConfirmResponse =
  | { ok: true; status: 'bound'; paymentMethodId: string; duplicate: boolean }  // duplicate＝這張卡之前已綁過（提示「已綁過」）
  | { ok: true; status: 'need3d'; url: string }                                 // 整頁跳轉 location.href = url（不要 iframe、不要開新分頁）
  | { ok: true; status: 'confirming' }                                          // 結果不明，輪詢 payment-bind-status
  | { ok: true; status: 'failed'; code: string; message: string };
export interface BindStatusRequest { merchantTradeNo: string }
export type BindStatusResponse =
  | { ok: true; status: 'created' | 'confirming' }
  | { ok: true; status: 'bound'; paymentMethodId: string; duplicate: boolean }
  | { ok: true; status: 'failed'; code: string; message: string };
/** 3D 後綠界把買家導回前端：<網站>/#<returnPath>?bind=<bound|failed|confirming>&no=<merchantTradeNo> */
export type BindReturnQuery = { bind: 'bound' | 'failed' | 'confirming'; no: string };

export interface MethodDeleteRequest { id: string }
export interface MethodDeleteResponse { ok: true; status: 'deleted' | 'revoking' } // revoking＝已隱藏、不能再扣款，伺服器稍後向綠界撤銷

// ── 結帳 ──
/** RPC place_online_order 的參數與回傳（ok 時；rejected 同 place_checked_order） */
export interface PlaceOnlineOrderArgs {
  p_items: { productId: string; variantId: string; qty: number; price: number }[];
  p_buyer: { name: string; phone: string; address: string };
  p_from_cart: boolean;
  p_seen_shipping: Record<string, number>;
  p_online_shop_ids: string[];   // 這次要線上付款的店（必須已開通）；其餘的店貨到付款
}
export interface PlaceOnlineOrderOk {
  outcome: 'ok';
  orders: { id: string; order_no: string; shop_id: string; total: number; status: string; payment: 'cod' | 'ecpay_card'; [k: string]: unknown }[];
  payGroupId: string;
  payTotal: number;          // 線上付款那幾張的合計
  expiresAt: string;         // 30 分鐘後
  onlineOrderIds: string[];
}

export interface PayRequest { groupId: string; paymentMethodId: string }
export interface FailureInfo {
  shopId: string | null;     // 哪一家店授權失敗
  orderId: string | null;
  rtnCode: number | null;
  message: string;           // 中文，可直接顯示
  cardInvalid: boolean;      // true：這張卡已失效，提示刪除並換卡
}
export type PayResponse =
  | { ok: true; outcome: 'paid'; groupId: string; group: PaymentGroupView }
  | { ok: true; outcome: 'failed'; groupId: string; failure: FailureInfo; group: PaymentGroupView }  // 全部放棄，訂單維持待付款，可換卡重付
  | { ok: true; outcome: 'confirming'; groupId: string; reason: string; group: PaymentGroupView };   // 結果確認中：不能再付，輪詢 payment-status

export interface PaymentStatusRequest { groupId: string }
export interface PaymentStatusResponse { ok: true; group: PaymentGroupView }

export type PaymentGroupStatus = 'pending' | 'processing' | 'confirming' | 'paid' | 'failed' | 'expired' | 'cancelled';
export type OrderPaymentStatus = 'none' | 'pending' | 'confirming' | 'paid' | 'failed' | 'expired';
export interface PaymentGroupView {
  groupId: string;
  status: PaymentGroupStatus;
  attemptNo: number;
  total: number;
  expiresAt: string;
  paidAt: string | null;
  lastFail: (FailureInfo & { attemptNo: number; at: string }) | null;
  orders: { orderId: string; orderNo: string; shopId: string; total: number; paymentStatus: OrderPaymentStatus; status: string }[];
}

/** RPC get_order_payments() 的一列（只有線上付款的訂單）；跟 get_account_orders() 用 order_id 接起來 */
export interface OrderPaymentRow {
  order_id: string;
  group_id: string | null;
  payment_status: OrderPaymentStatus;
  pay_expires_at: string | null;
  paid_at: string | null;
  card_brand: PaymentMethodRow['brand'] | null;
  card4: string | null;
  last_fail: (FailureInfo & { attemptNo: number; at: string }) | null;
}

/** RPC get_shops_online_payable([shopId]) */
export interface ShopOnlinePayable { shop_id: string; online_payable: boolean }

/** 賣家特約商店（P-C 資料部分）：from('seller_ecpay_merchants').select('*')（只讀得到自己的店）；填寫用 RPC submit_seller_ecpay_merchant */
export interface SellerEcpayMerchantRow {
  shop_id: string;
  ecpay_merchant_id: string;
  status: 'pending_review' | 'active' | 'rejected' | 'suspended';
  reason: string | null;
  created_at: string;
  updated_at: string;
  activated_at: string | null;
}
