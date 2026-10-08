import type { Category, Order, Product, Shop, Variant } from '../types';

export const CATEGORIES: Category[] = [
  { id: 'women', name: '女生衣著', icon: '👗' },
  { id: 'men', name: '男生衣著', icon: '👕' },
  { id: 'beauty', name: '美妝保養', icon: '💄' },
  { id: '3c', name: '3C 周邊', icon: '🎧' },
  { id: 'home', name: '居家生活', icon: '🛋️' },
  { id: 'food', name: '美食伴手禮', icon: '🍪' },
  { id: 'sports', name: '運動戶外', icon: '⛺' },
  { id: 'baby', name: '母嬰用品', icon: '🧸' },
];

export const SEED_SHOPS: Shop[] = [
  { id: 'shop_daily', name: '日常選物所', avatar: '🌿', description: '簡單好用的生活選物，台北現貨 24h 出貨', location: '臺北市', rating: 4.9, joinedAt: '2023-03-01' },
  { id: 'shop_gadget', name: '小機器 3C', avatar: '🔌', description: '3C 周邊專賣，全館一年保固', location: '新北市', rating: 4.8, joinedAt: '2022-11-15' },
  { id: 'shop_wear', name: '穿搭研究室', avatar: '🧥', description: '韓系平價穿搭，每週上新', location: '臺中市', rating: 4.7, joinedAt: '2024-01-20' },
  { id: 'shop_taste', name: '在地好味道', avatar: '🍯', description: '嚴選台灣小農與老字號伴手禮', location: '臺南市', rating: 5.0, joinedAt: '2023-08-08' },
];

// 示範插圖：emoji + 漸層底，避免示範資料依賴外部圖床
const art = (emoji: string, from: string, to: string) => `art:${emoji}:${from}:${to}`;

let seq = 0;
const v = (name: string, price: number, stock: number): Variant => ({ id: `v${++seq}`, name, price, stock });

// 示範資料沿用「整件商品一個原價」的寫法，產生時再依各規格售價換算成各自的原價
type SeedInput = Omit<Product, 'id' | 'status' | 'createdAt' | 'location'> & {
  daysAgo: number;
  originalPrice?: number;
};

const shopLocation = (shopId: string) => SEED_SHOPS.find(s => s.id === shopId)?.location ?? '臺北市';

const make = (list: SeedInput[]): Product[] =>
  list.map(({ daysAgo, originalPrice, ...p }, i) => {
    const cheapest = Math.min(...p.variants.map(v => v.price));
    // 各規格維持一致的折扣幅度
    const ratio = originalPrice ? originalPrice / cheapest : 0;
    return {
      ...p,
      variants: p.variants.map(v => (ratio ? { ...v, originalPrice: Math.round(v.price * ratio) } : v)),
      id: `p${String(i + 1).padStart(3, '0')}`,
      status: 'active' as const,
      location: shopLocation(p.shopId),
      createdAt: new Date(Date.now() - daysAgo * 86400000).toISOString(),
    };
  });

export const SEED_PRODUCTS: Product[] = make([
  { shopId: 'shop_gadget', title: '【一年保固】主動降噪藍牙耳機 40 小時續航 低延遲遊戲模式', description: '主動降噪深度 -35dB，通透模式一鍵切換。\n單次充電 8 小時、搭配充電盒共 40 小時。\nIPX4 防潑水，運動通勤都適用。', categoryId: '3c', images: [art('🎧', '#dbeafe', '#93c5fd'), art('🎵', '#e0e7ff', '#a5b4fc')], variants: [v('曜石黑', 1290, 58), v('月光白', 1290, 34), v('霧藍', 1390, 12)], originalPrice: 2490, sold: 12840, rating: 4.9, freeShipping: true, daysAgo: 40 },
  { shopId: 'shop_gadget', title: '65W 氮化鎵快充頭 三孔 PD/QC 筆電手機平板通用', description: '一顆充電頭搞定筆電、平板、手機。\n體積比原廠小 40%，出國旅行必備。', categoryId: '3c', images: [art('🔌', '#f1f5f9', '#cbd5e1')], variants: [v('白色', 690, 120), v('黑色', 690, 88)], originalPrice: 990, sold: 8420, rating: 4.8, freeShipping: true, daysAgo: 60 },
  { shopId: 'shop_gadget', title: 'iPhone 17 磁吸透明手機殼 軍規防摔 不發黃', description: '支援 MagSafe 磁吸充電，四角氣囊防摔。\n抗黃化材質，半年不變色。', categoryId: '3c', images: [art('📱', '#fce7f3', '#f9a8d4')], variants: [v('iPhone 17', 390, 200), v('iPhone 17 Pro', 390, 150), v('iPhone 17 Pro Max', 420, 90)], originalPrice: 590, sold: 23150, rating: 4.7, freeShipping: false, daysAgo: 12 },
  { shopId: 'shop_gadget', title: '機械式鍵盤 熱插拔 RGB 背光 茶軸 / 紅軸', description: '全鍵熱插拔，可自行更換軸體。\n有線 / 藍牙 / 2.4G 三模連線。', categoryId: '3c', images: [art('⌨️', '#ede9fe', '#c4b5fd')], variants: [v('茶軸', 1890, 25), v('紅軸', 1890, 31)], originalPrice: 2680, sold: 1960, rating: 4.9, freeShipping: true, daysAgo: 5 },
  { shopId: 'shop_gadget', title: '10000mAh 磁吸行動電源 超薄 自帶支架', description: '厚度僅 1.2cm，吸上手機直接充。\n背面折疊支架，追劇好方便。', categoryId: '3c', images: [art('🔋', '#dcfce7', '#86efac')], variants: [v('奶茶色', 890, 70), v('石墨灰', 890, 64)], originalPrice: 1280, sold: 5310, rating: 4.8, freeShipping: true, daysAgo: 22 },

  { shopId: 'shop_wear', title: '韓系寬鬆落肩大學 T 重磅純棉 男女同款', description: '380g 重磅棉，不易變形。\n落肩寬版剪裁，身形友善。', categoryId: 'men', images: [art('👕', '#fef3c7', '#fcd34d')], variants: [v('燕麥 / M', 490, 40), v('燕麥 / L', 490, 38), v('黑色 / M', 490, 52), v('黑色 / L', 490, 47)], originalPrice: 790, sold: 15600, rating: 4.8, freeShipping: false, daysAgo: 30 },
  { shopId: 'shop_wear', title: '高腰顯瘦直筒牛仔褲 彈性不緊繃 四季可穿', description: '高腰設計修飾比例，微彈布料好活動。', categoryId: 'women', images: [art('👖', '#dbeafe', '#60a5fa')], variants: [v('淺藍 / S', 690, 20), v('淺藍 / M', 690, 26), v('深藍 / S', 690, 18), v('深藍 / M', 690, 22)], originalPrice: 1180, sold: 9870, rating: 4.7, freeShipping: false, daysAgo: 18 },
  { shopId: 'shop_wear', title: '法式碎花洋裝 V 領收腰 約會通勤', description: '雪紡雙層不透膚，收腰綁帶可調整。', categoryId: 'women', images: [art('👗', '#ffe4e6', '#fda4af')], variants: [v('奶油黃', 880, 15), v('霧粉', 880, 19)], originalPrice: 1380, sold: 3240, rating: 4.9, freeShipping: true, daysAgo: 3 },
  { shopId: 'shop_wear', title: '防潑水連帽風衣外套 輕量可收納', description: '輕量 280g，可收進口袋。\n表布防潑水，突然下雨也不怕。', categoryId: 'men', images: [art('🧥', '#e7e5e4', '#a8a29e')], variants: [v('卡其 / M', 1280, 14), v('卡其 / L', 1280, 11), v('黑色 / L', 1280, 9)], originalPrice: 1980, sold: 2110, rating: 4.6, freeShipping: true, daysAgo: 9 },
  { shopId: 'shop_wear', title: '復古老爹鞋 厚底增高 5cm 百搭休閒鞋', description: '厚底增高但輕量，久走不累。', categoryId: 'women', images: [art('👟', '#f5f5f4', '#d6d3d1')], variants: [v('米白 / 37', 1090, 12), v('米白 / 38', 1090, 16), v('米白 / 39', 1090, 8)], originalPrice: 1690, sold: 4780, rating: 4.8, freeShipping: true, daysAgo: 26 },

  { shopId: 'shop_daily', title: '無印風陶瓷馬克杯 350ml 手作釉色 可微波', description: '每一個釉色都略有不同，獨一無二。\n可微波、可洗碗機。', categoryId: 'home', images: [art('☕', '#fef3c7', '#fde68a')], variants: [v('奶白', 320, 60), v('抹茶綠', 320, 45), v('霧灰', 320, 38)], originalPrice: 450, sold: 6620, rating: 4.9, freeShipping: false, daysAgo: 50 },
  { shopId: 'shop_daily', title: '天然大豆香氛蠟燭 木芯 燃燒 45 小時', description: '大豆蠟＋木質燭芯，燃燒時有細微劈啪聲。', categoryId: 'home', images: [art('🕯️', '#fae8ff', '#e9d5ff')], variants: [v('白茶', 580, 30), v('雪松', 580, 27), v('無花果', 580, 22)], originalPrice: 780, sold: 3880, rating: 5.0, freeShipping: true, daysAgo: 14 },
  { shopId: 'shop_daily', title: '北歐風針織抱枕套 45x45 可拆洗', description: '粗針織紋理，秋冬放沙發超有氛圍。', categoryId: 'home', images: [art('🛋️', '#ecfccb', '#bef264')], variants: [v('燕麥色', 350, 80), v('焦糖色', 350, 66)], originalPrice: 490, sold: 2450, rating: 4.7, freeShipping: false, daysAgo: 35 },
  { shopId: 'shop_daily', title: '玻尿酸保濕精華液 30ml 敏感肌可用', description: '三重分子玻尿酸，由內而外補水。\n無香料、無酒精。', categoryId: 'beauty', images: [art('🧴', '#e0f2fe', '#7dd3fc')], variants: [v('30ml', 650, 90), v('30ml 兩入組', 1180, 40)], originalPrice: 980, sold: 18300, rating: 4.9, freeShipping: true, daysAgo: 20 },
  { shopId: 'shop_daily', title: '絲絨霧面唇釉 顯白不沾杯 6 色', description: '霧面絲絨質地，持色 8 小時。', categoryId: 'beauty', images: [art('💄', '#ffe4e6', '#fb7185')], variants: [v('#01 楓葉紅', 399, 50), v('#03 奶茶', 399, 62), v('#05 豆沙', 399, 48)], originalPrice: 580, sold: 11200, rating: 4.8, freeShipping: false, daysAgo: 8 },
  { shopId: 'shop_daily', title: '嬰兒有機棉包巾 雙層紗布 透氣吸汗', description: '有機棉雙層紗布，越洗越柔軟。', categoryId: 'baby', images: [art('🧸', '#fef9c3', '#fde047')], variants: [v('小熊', 460, 35), v('雲朵', 460, 29)], originalPrice: 620, sold: 1540, rating: 5.0, freeShipping: false, daysAgo: 16 },

  { shopId: 'shop_taste', title: '台南老字號手工鳳梨酥 12 入禮盒 土鳳梨餡', description: '選用關廟土鳳梨，酸甜不膩。\n保存期限 30 天，中秋送禮首選。', categoryId: 'food', images: [art('🍍', '#fef9c3', '#facc15')], variants: [v('12 入禮盒', 520, 150), v('24 入禮盒', 980, 60)], originalPrice: 680, sold: 21400, rating: 5.0, freeShipping: false, daysAgo: 45 },
  { shopId: 'shop_taste', title: '阿里山高山烏龍茶 150g 真空包 春茶', description: '海拔 1400 公尺茶區，蘭花香回甘。', categoryId: 'food', images: [art('🍵', '#dcfce7', '#4ade80')], variants: [v('150g', 780, 70), v('150g x 2', 1480, 30)], originalPrice: 980, sold: 4120, rating: 4.9, freeShipping: true, daysAgo: 28 },
  { shopId: 'shop_taste', title: '龍眼花蜂蜜 700g 台灣在地蜂農直送', description: '無添加純蜂蜜，SGS 檢驗合格。', categoryId: 'food', images: [art('🍯', '#ffedd5', '#fb923c')], variants: [v('700g', 450, 90)], originalPrice: 600, sold: 7760, rating: 4.9, freeShipping: false, daysAgo: 11 },
  { shopId: 'shop_taste', title: '手工奶油曲奇餅乾 鐵盒裝 綜合口味', description: '法國發酵奶油，每日小量烘焙。', categoryId: 'food', images: [art('🍪', '#fef3c7', '#d97706')], variants: [v('綜合口味', 399, 110), v('伯爵紅茶', 420, 45)], originalPrice: 499, sold: 9340, rating: 4.8, freeShipping: false, daysAgo: 2 },

  { shopId: 'shop_gadget', title: '露營 LED 氛圍燈 USB-C 充電 三段調光', description: '暖光氛圍，可掛可立。\n滿電可用 20 小時。', categoryId: 'sports', images: [art('⛺', '#e0f2fe', '#38bdf8')], variants: [v('軍綠', 560, 40), v('沙色', 560, 36)], originalPrice: 790, sold: 2890, rating: 4.8, freeShipping: false, daysAgo: 7 },
  { shopId: 'shop_wear', title: '瑜珈墊 8mm 加厚 TPE 雙面防滑 附背帶', description: 'TPE 環保材質無異味，雙面防滑紋路。', categoryId: 'sports', images: [art('🧘', '#f3e8ff', '#c084fc')], variants: [v('薰衣草紫', 590, 55), v('鼠尾草綠', 590, 48)], originalPrice: 890, sold: 5670, rating: 4.7, freeShipping: true, daysAgo: 24 },
  { shopId: 'shop_daily', title: '316 不鏽鋼保溫瓶 750ml 保冷 24 小時', description: '醫療級 316 不鏽鋼，裝咖啡、果汁都安心。', categoryId: 'sports', images: [art('🥤', '#ccfbf1', '#2dd4bf')], variants: [v('霧黑', 690, 60), v('奶油白', 690, 52), v('湖水綠', 720, 20)], originalPrice: 1090, sold: 13900, rating: 4.9, freeShipping: true, daysAgo: 33 },
  { shopId: 'shop_daily', title: '寶寶矽膠餐盤組 吸盤防翻 分隔設計', description: '食品級矽膠，強力吸盤不怕寶寶打翻。', categoryId: 'baby', images: [art('🍼', '#e0e7ff', '#818cf8')], variants: [v('奶油藍', 520, 40), v('杏桃粉', 520, 38)], originalPrice: 680, sold: 3310, rating: 4.9, freeShipping: false, daysAgo: 19 },
]);

export const SEED_ORDERS: Order[] = [
  {
    id: 'ord_demo1', shopId: 'shop_gadget', status: 'to_ship', payment: 'cod', shippingFee: 60,
    lines: [{ productId: 'p001', variantId: 'v1', title: SEED_PRODUCTS[0].title, variantName: '曜石黑', image: SEED_PRODUCTS[0].images[0], price: 1290, qty: 1 }],
    total: 1350, buyer: { name: '王小明', phone: '0912-345-678', address: '臺北市大安區復興南路一段 100 號' },
    createdAt: new Date(Date.now() - 3 * 3600000).toISOString(),
  },
  {
    id: 'ord_demo2', shopId: 'shop_gadget', status: 'shipping', payment: 'card', shippingFee: 0,
    lines: [{ productId: 'p002', variantId: 'v4', title: SEED_PRODUCTS[1].title, variantName: '白色', image: SEED_PRODUCTS[1].images[0], price: 690, qty: 2 }],
    total: 1380, buyer: { name: '林美玲', phone: '0922-111-222', address: '新北市板橋區文化路二段 50 號' },
    createdAt: new Date(Date.now() - 30 * 3600000).toISOString(),
  },
];
