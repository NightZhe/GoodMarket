import { useState } from 'react';
import { ImageOff } from 'lucide-react';
import { reviewPhotoUrl } from '../../lib/reviews/api';
import { focusRing } from '../import/ui';

interface Props {
  paths: string[];
  /** 點縮圖：帶出起始張數與被點的按鈕（大圖關閉後把焦點還給它） */
  onOpen: (index: number, trigger: HTMLButtonElement) => void;
}

/** 評價照片的縮圖列（買家與賣家共用）。縮圖 alt 留空，名稱由按鈕提供 */
export default function PhotoThumbs({ paths, onOpen }: Props) {
  const [broken, setBroken] = useState<Set<string>>(() => new Set());
  const [loaded, setLoaded] = useState<Set<string>>(() => new Set());
  if (paths.length === 0) return null;
  const mark = (set: Set<string>, p: string) => new Set(set).add(p);

  return (
    <ul className="mt-2.5 grid grid-cols-5 gap-2 md:grid-cols-[repeat(5,5rem)] md:gap-2.5">
      {paths.map((p, i) => {
        const bad = broken.has(p);
        const name = bad ? `評價照片 ${i + 1} 無法載入` : `放大查看評價照片 ${i + 1}，共 ${paths.length} 張`;
        return (
          <li key={p}>
            <button
              type="button" aria-label={name} aria-disabled={bad || undefined}
              onClick={e => { if (!bad) onOpen(i, e.currentTarget); }}
              className={`relative block aspect-square w-full overflow-hidden rounded-sm border border-line bg-canvas ${loaded.has(p) || bad ? '' : 'motion-safe:animate-pulse'} ${focusRing}`}
            >
              {bad ? (
                <span className="flex h-full w-full items-center justify-center text-muted"><ImageOff size={20} aria-hidden="true" /></span>
              ) : (
                <img
                  src={reviewPhotoUrl(p)} alt="" loading="lazy"
                  onLoad={() => setLoaded(s => mark(s, p))}
                  onError={() => setBroken(s => mark(s, p))}
                  className="h-full w-full object-cover"
                />
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
