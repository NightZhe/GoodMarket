import { useState } from 'react';
import { ImageOff } from 'lucide-react';

interface Props {
  /** 伺服器訊息＝私有 bucket 路徑；本機訊息＝本機縮圖網址（local） */
  paths: string[];
  local: boolean;
  /** 路徑 → 簽名網址 */
  urls: Record<string, string>;
  /** 換簽名網址本身失敗（網路） */
  signFailed: boolean;
  /** 簽名網址過期或載入失敗：重換 */
  onBroken: (path: string) => void;
  onOpen: (index: number, trigger: HTMLElement) => void;
}

// 1 張＝單格；2、4 張＝2 欄；3 張＝第一張橫跨整列；5 張＝上排 3、下排 2（用 6 欄切）
function cellClass(count: number, i: number): string {
  if (count === 1) return 'aspect-square';
  if (count === 3 && i === 0) return 'col-span-2 aspect-[2/1]';
  if (count === 5) return i < 3 ? 'col-span-2 aspect-square' : 'col-span-3 aspect-square';
  return 'aspect-square';
}

/**
 * 訊息裡的圖片格（無底、無氣泡）。每格是一顆按鈕，點開全螢幕檢視。
 * 載入失敗（簽名網址過期）先自動換一次網址重試；仍失敗就顯示圖示，點一下再試
 */
export default function MessageImages({ paths, local, urls, signFailed, onBroken, onOpen }: Props) {
  const [broken, setBroken] = useState<Record<string, boolean>>({});
  const [autoTried, setAutoTried] = useState<Record<string, boolean>>({});
  const count = paths.length;
  const cols = count === 5 ? 'grid-cols-6' : count === 1 ? 'grid-cols-1' : 'grid-cols-2';

  const onError = (p: string) => {
    if (local) return;
    if (!autoTried[p]) {
      setAutoTried(s => ({ ...s, [p]: true }));
      onBroken(p);
    } else {
      setBroken(s => ({ ...s, [p]: true }));
    }
  };

  return (
    <div className={`grid w-[min(78%,12.5rem)] gap-0.5 overflow-hidden rounded-card ${cols}`}>
      {paths.map((p, i) => {
        const src = local ? p : urls[p];
        const failed = !local && (broken[p] || (!src && signFailed));
        const label = count > 1 ? `圖片 ${i + 1}／${count}` : '圖片';
        return (
          <button
            key={p}
            type="button"
            aria-label={failed ? `${label}，載入失敗，點一下重試` : label}
            onClick={e => {
              if (failed) {
                setBroken(s => ({ ...s, [p]: false }));
                onBroken(p);
                return;
              }
              onOpen(i, e.currentTarget);
            }}
            className={`relative min-h-11 overflow-hidden bg-canvas ${cellClass(count, i)}`}
          >
            {src && !failed && (
              <img
                src={src}
                alt={label}
                loading="lazy"
                onError={() => onError(p)}
                className="size-full object-cover"
              />
            )}
            {failed && <span aria-hidden="true" className="absolute inset-0 grid place-items-center text-muted"><ImageOff size={20} /></span>}
          </button>
        );
      })}
    </div>
  );
}
