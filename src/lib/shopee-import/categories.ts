import type { CategoryId } from '../../types';

/** 蝦皮分類 ID → 好物集分類（規格第 4 節）。表外 ID 一律 other */
export const SHOPEE_CATEGORY_MAP: Readonly<Record<string, CategoryId>> = {
  '101087': 'games', // Gaming & Consoles/Video Games/Switch
  '101388': 'toys',  // Collectible Items/Vehicle Models & Diecast
  '101082': 'games', // Gaming & Consoles/Video Games/Playstation
  '101400': 'toys',  // Toys & Games/Dice, Board & Card Games
  '101387': 'toys',  // Collectible Items/Mecha Models & Diecast
  '101394': 'toys',  // Collectible Items/Others
  '101385': 'toys',  // Collectible Items/Action Figurines
  '100766': 'other', // Tickets, Vouchers & Services/Transport
  '100085': 'other', // Travel & Luggage/Luggage
  '101721': 'toys',  // Mom & Baby/Toys/Dolls & Stuffed Toys/Doll Houses & Accessories
  '101514': 'other', // Tickets, Vouchers & Services/Services/Others
  '101241': 'home',  // Home & Living/Dinnerware/Water Bottles & Accessories
  '100772': 'games', // Tickets, Vouchers & Services/Gaming & App Stores
  '101407': 'toys',  // Toys & Games/Remote Control Toys & Accessories
};

/** 取「 - 」前的數字 ID；不是數字（或空白）回 null */
export function parseShopeeCategoryId(raw: string): string | null {
  const head = raw.split(' - ')[0].trim();
  return /^\d+$/.test(head) ? head : null;
}

export function mapShopeeCategory(raw: string): CategoryId {
  const id = parseShopeeCategoryId(raw);
  if (id === null) return 'other';
  return Object.hasOwn(SHOPEE_CATEGORY_MAP, id) ? SHOPEE_CATEGORY_MAP[id] : 'other';
}
