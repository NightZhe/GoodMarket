import { useState } from 'react';
import { ImageOff } from 'lucide-react';

/** 預覽用的封面縮圖（蝦皮原網址）。載入失敗改顯示圖示，不出現破圖 */
export default function Cover({ src }: { src: string | null }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-sm bg-canvas text-muted">
        <ImageOff size={20} aria-hidden="true" />
        <span className="sr-only">沒有封面圖</span>
      </span>
    );
  }
  return (
    <img
      src={src} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)}
      className="h-14 w-14 shrink-0 rounded-sm bg-canvas object-cover"
    />
  );
}
