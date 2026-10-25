import { money, soldText } from '../format';

export interface CardLabelInput {
  title: string;
  price: number;
  originalPrice?: number;
  sold: number;
  /** 店家資料還沒載入時是 undefined，該段略過 */
  shopName?: string;
  location: string;
  soldOut: boolean;
}

/** 商品卡與列表列整張一個連結的 aria-label：標題，價格，（已售 N，）店名，地點（，已售完） */
export function cardLabel({ title, price, originalPrice, sold, shopName, location, soldOut }: CardLabelInput): string {
  const priceText = originalPrice && originalPrice > price
    ? `${money(price)}，原價 ${money(originalPrice)}`
    : money(price);
  return [
    title,
    priceText,
    sold > 0 ? `已售 ${soldText(sold)}` : '',
    shopName,
    location,
    soldOut ? '已售完' : '',
  ].filter(Boolean).join('，');
}
