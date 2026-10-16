import { Suspense, lazy } from 'react';
import { Navigate, Outlet, Route, RouterProvider, createHashRouter, createRoutesFromElements } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { StoreProvider } from './store/StoreContext';
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
import { ReviewsProvider } from './store/ReviewsContext';
import SellerGate from './pages/seller/SellerGate';
import SellerLayout from './pages/seller/SellerLayout';
import SellerDashboard from './pages/seller/SellerDashboard';
import SellerProducts from './pages/seller/SellerProducts';
import ProductForm from './pages/seller/ProductForm';
import SellerOrders from './pages/seller/SellerOrders';
import SellerReviews from './pages/seller/SellerReviews';

// 匯入精靈很少用到，且會載入約 650 KB 的 Excel 解析程式，所以整頁延後載入
const ImportWizard = lazy(() => import('./pages/seller/ImportWizard'));

function Root() {
  return (
    <>
      <ScrollToTop />
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
const router = createHashRouter(createRoutesFromElements(
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
      </Route>
    </Route>

    <Route path="*" element={<Navigate to="/" replace />} />
  </Route>,
));

export default function App() {
  // 沒設定後端金鑰就不要讓整站壞在看不懂的錯誤上
  if (!isConfigured) return <SetupNotice />;

  return (
    <StoreProvider>
      <ReviewsProvider>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </ReviewsProvider>
    </StoreProvider>
  );
}
