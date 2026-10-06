import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
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
import SellerGate from './pages/seller/SellerGate';
import SellerLayout from './pages/seller/SellerLayout';
import SellerDashboard from './pages/seller/SellerDashboard';
import SellerProducts from './pages/seller/SellerProducts';
import ProductForm from './pages/seller/ProductForm';
import SellerOrders from './pages/seller/SellerOrders';

// GitHub Pages 是純靜態主機，沒有 SPA fallback，所以用 HashRouter（網址會是 /#/product/p001）
export default function App() {
  // 沒設定後端金鑰就不要讓整站壞在看不懂的錯誤上
  if (!isConfigured) return <SetupNotice />;

  return (
    <StoreProvider>
      <ToastProvider>
        <HashRouter>
          <ScrollToTop />
          <Routes>
            {/* 買家前台 */}
            <Route element={<BuyerLayout />}>
              <Route index element={<Home />} />
              <Route path="search" element={<Search />} />
              <Route path="product/:id" element={<ProductDetail />} />
              <Route path="shop/:id" element={<ShopPage />} />
              <Route path="cart" element={<Cart />} />
              <Route path="checkout" element={<Checkout />} />
              <Route path="orders" element={<Orders />} />
            </Route>

            {/* 賣家中心（後台） */}
            <Route path="seller" element={<SellerGate />}>
              <Route element={<SellerLayout />}>
                <Route index element={<SellerDashboard />} />
                <Route path="products" element={<SellerProducts />} />
                <Route path="products/new" element={<ProductForm />} />
                <Route path="products/:id/edit" element={<ProductForm />} />
                <Route path="orders" element={<SellerOrders />} />
              </Route>
            </Route>

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </HashRouter>
      </ToastProvider>
    </StoreProvider>
  );
}
