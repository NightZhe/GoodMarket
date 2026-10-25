import { Suspense, lazy, useState } from 'react';
import { Navigate, Outlet, Route, RouterProvider, createHashRouter, createRoutesFromElements } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { StoreProvider } from './store/StoreContext';
import { AuthProvider } from './store/AuthContext';
import AuthBoot from './components/auth/AuthBoot';
import PendingRunner from './components/auth/PendingRunner';
import { isConfigured } from './lib/supabase';
import SetupNotice from './pages/SetupNotice';
import { ToastProvider } from './components/Toast';
import ScrollToTop from './components/ScrollToTop';
import BuyerLayout from './pages/buyer/BuyerLayout';
import Home from './pages/buyer/Home';
import Search from './pages/buyer/Search';
import ProductDetail from './pages/buyer/ProductDetail';
import Cart from './pages/buyer/Cart';
import Checkout from './pages/buyer/Checkout';
import Orders from './pages/buyer/Orders';
import ShopPage from './pages/buyer/ShopPage';
import ReviewForm from './pages/buyer/ReviewForm';
import ReviewsOverview from './pages/buyer/ReviewsOverview';
import Account from './pages/buyer/Account';
import AccountProfile from './pages/buyer/AccountProfile';
import AccountAddresses from './pages/buyer/AccountAddresses';
import AccountAddressForm from './pages/buyer/AccountAddressForm';
import BindPhone from './pages/buyer/BindPhone';
import PaymentMethods from './pages/buyer/PaymentMethods';
import PaymentMethodNew from './pages/buyer/PaymentMethodNew';
import PaymentBindResult from './pages/buyer/PaymentBindResult';
import AccountPayout from './pages/buyer/AccountPayout';
import PayResult from './pages/buyer/PayResult';
import Privacy from './pages/buyer/Privacy';
import { ReviewsProvider } from './store/ReviewsContext';
import SellerGate from './pages/seller/SellerGate';
import SellerLayout from './pages/seller/SellerLayout';
import SellerDashboard from './pages/seller/SellerDashboard';
import SellerProducts from './pages/seller/SellerProducts';
import ProductForm from './pages/seller/ProductForm';
import SellerOrders from './pages/seller/SellerOrders';
import SellerReviews from './pages/seller/SellerReviews';
import SellerPayout from './pages/seller/SellerPayout';
import SellerLogistics from './pages/seller/SellerLogistics';
import SellerLogisticsStoreForm from './pages/seller/SellerLogisticsStoreForm';
import SellerLogisticsAddressForm from './pages/seller/SellerLogisticsAddressForm';
import RequirePayment from './components/payment/RequirePayment';

// 匯入精靈很少用到，且會載入約 650 KB 的 Excel 解析程式，所以整頁延後載入
const ImportWizard = lazy(() => import('./pages/seller/ImportWizard'));

function Root() {
  return (
    <>
      <ScrollToTop />
      <PendingRunner />
      <Outlet />
    </>
  );
}

function PageLoading() {
  return (
    <div role="status" className="flex min-h-64 items-center justify-center text-muted">
      <Loader2 className="motion-safe:animate-spin" size={28} aria-hidden="true" />
      <span className="sr-only">載入中</span>
    </div>
  );
}

// 用 data router 才有 useBlocker：匯入進行中，站內導覽（側欄、返回鍵）要先經過離開確認
// GitHub Pages 是純靜態主機，沒有 SPA fallback，所以用 hash（網址會是 /#/product/p001）
// 路由器要等登入回跳處理完才建立（見 AuthBoot）：它建立時才讀網址的 hash，那時 hash 已經是要回去的那一頁
const createRouter = () => createHashRouter(createRoutesFromElements(
  <Route element={<Root />}>
    {/* 買家前台 */}
    <Route element={<BuyerLayout />}>
      <Route index element={<Home />} />
      <Route path="search" element={<Search />} />
      <Route path="product/:id" element={<ProductDetail />} />
      <Route path="product/:id/reviews" element={<ReviewsOverview />} />
      <Route path="shop/:id" element={<ShopPage />} />
      <Route path="cart" element={<Cart />} />
      <Route path="checkout" element={<Checkout />} />
      <Route path="orders" element={<Orders />} />
      <Route path="orders/:orderId/review" element={<ReviewForm />} />
      <Route path="account" element={<Account />} />
      <Route path="account/profile" element={<AccountProfile />} />
      <Route path="account/addresses" element={<AccountAddresses />} />
      <Route path="account/addresses/new" element={<AccountAddressForm />} />
      <Route path="account/addresses/:id" element={<AccountAddressForm />} />
      <Route path="account/phone" element={<BindPhone />} />
      {/* 線上付款開關關著時，這幾頁直接輸入網址也進不去（導回帳號頁） */}
      <Route path="account/payment-methods" element={<RequirePayment to="/account"><PaymentMethods /></RequirePayment>} />
      <Route path="account/payment-methods/new" element={<RequirePayment to="/account"><PaymentMethodNew /></RequirePayment>} />
      <Route path="account/payment-methods/result" element={<RequirePayment to="/account"><PaymentBindResult /></RequirePayment>} />
      <Route path="account/payout" element={<RequirePayment to="/account"><AccountPayout /></RequirePayment>} />
      <Route path="pay/:paymentId" element={<PayResult />} />
      <Route path="privacy" element={<Privacy />} />
    </Route>

    {/* 賣家中心（後台） */}
    <Route path="seller" element={<SellerGate />}>
      <Route element={<SellerLayout />}>
        <Route index element={<SellerDashboard />} />
        <Route path="products" element={<SellerProducts />} />
        <Route path="products/new" element={<ProductForm />} />
        <Route path="products/import" element={<Suspense fallback={<PageLoading />}><ImportWizard /></Suspense>} />
        <Route path="products/:id/edit" element={<ProductForm />} />
        <Route path="orders" element={<SellerOrders />} />
        <Route path="reviews" element={<SellerReviews />} />
        <Route path="logistics" element={<SellerLogistics />} />
        <Route path="logistics/stores/new" element={<SellerLogisticsStoreForm />} />
        <Route path="logistics/stores/:id" element={<SellerLogisticsStoreForm />} />
        <Route path="logistics/address" element={<SellerLogisticsAddressForm />} />
        <Route path="payout" element={<RequirePayment to="/seller"><SellerPayout /></RequirePayment>} />
      </Route>
    </Route>

    <Route path="*" element={<Navigate to="/" replace />} />
  </Route>,
));

function Routed() {
  const [router] = useState(createRouter);
  return <RouterProvider router={router} />;
}

export default function App() {
  // 沒設定後端金鑰就不要讓整站壞在看不懂的錯誤上
  if (!isConfigured) return <SetupNotice />;

  return (
    <AuthBoot>
      <StoreProvider>
        <ReviewsProvider>
          <ToastProvider>
            <AuthProvider>
              <Routed />
            </AuthProvider>
          </ToastProvider>
        </ReviewsProvider>
      </StoreProvider>
    </AuthBoot>
  );
}
