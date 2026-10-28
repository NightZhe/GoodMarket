/** 數字徽章（購物車件數、賣家待出貨）。絕對定位，掛在 `relative` 的父層；純裝飾（aria-hidden），數字由父層的 aria-label 唸 */
export function CountBadge({ count, className }: { count: number; className: string }) {
  if (count <= 0) return null;
  return (
    <span aria-hidden="true" className={`absolute min-w-[18px] rounded-full bg-badge px-[5px] text-center text-[12px] font-semibold leading-[18px] text-white ring-2 ring-white ${className}`}>
      {count > 99 ? '99+' : count}
    </span>
  );
}
