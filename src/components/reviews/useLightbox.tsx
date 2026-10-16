import { useCallback, useState, type ReactNode } from 'react';
import PhotoLightbox from './PhotoLightbox';

interface Open { paths: string[]; index: number; trigger: HTMLElement | null }

/** 頁面上共用一個大圖檢視器：縮圖呼叫 open，把 element 放進畫面任何位置 */
export function useLightbox(): { open: (paths: string[], index: number, trigger: HTMLElement) => void; element: ReactNode } {
  const [state, setState] = useState<Open | null>(null);
  const open = useCallback((paths: string[], index: number, trigger: HTMLElement) => setState({ paths, index, trigger }), []);
  const element = state && (
    <PhotoLightbox
      paths={state.paths} startIndex={state.index} returnFocusTo={state.trigger}
      onClose={() => setState(null)}
    />
  );
  return { open, element };
}
