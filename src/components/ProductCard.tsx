import { Link } from 'react-router-dom';
import { MapPin, Star } from 'lucide-react';
import type { Product } from '../types';
import ProductImage from './ProductImage';
import { cheapestVariant, discountOf, money, soldText } from '../lib/format';

export default function ProductCard({ product }: { product: Product }) {
  const cheapest = cheapestVariant(product.variants);
  const min = cheapest?.price ?? 0;
  const discount = discountOf(cheapest);
  const soldOut = product.variants.every(v => v.stock === 0);

  return (
    <Link
      to={`/product/${product.id}`}
      className="group flex flex-col overflow-hidden rounded-md border border-transparent bg-white transition hover:-translate-y-0.5 hover:border-brand hover:shadow-card-hover"
    >
      <div className="relative">
        <ProductImage src={product.images[0]} alt={product.title} className="w-full" />
        {discount > 0 && (
          <span className="absolute right-0 top-0 rounded-bl-md bg-brand-dark px-1.5 py-0.5 text-[11px] font-semibold text-white">
            -{discount}%
          </span>
        )}
        {soldOut && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/60">
            <span className="rounded-full bg-black/70 px-3 py-1 text-xs text-white">已售完</span>
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-2">
        <h3 className="line-clamp-2 text-[13px] leading-[1.35] text-ink">{product.title}</h3>
        {product.freeShipping && (
          <span className="w-fit rounded-sm border border-success px-1 text-[10px] leading-4 text-success">免運</span>
        )}
        <div className="mt-auto flex flex-wrap items-baseline justify-between gap-x-1.5 gap-y-0.5">
          <span className="flex items-baseline gap-1.5">
            <span className="text-base font-medium text-brand">{money(min)}</span>
            {discount > 0 && cheapest?.originalPrice && (
              <span className="text-[11px] text-muted line-through">{money(cheapest.originalPrice)}</span>
            )}
          </span>
          <span className="text-[11px] text-muted">已售 {soldText(product.sold)}</span>
        </div>
        <div className="flex items-center justify-between text-[11px] text-muted">
          <span className="flex items-center gap-0.5">
            <Star size={11} className="fill-star text-star" />
            {product.rating.toFixed(1)}
          </span>
          <span className="flex items-center gap-0.5">
            <MapPin size={11} />
            {product.location}
          </span>
        </div>
      </div>
    </Link>
  );
}
