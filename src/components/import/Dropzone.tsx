import { useRef, useState, type DragEvent } from 'react';
import { Upload } from 'lucide-react';
import { btnOutline } from './ui';

const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer.types).includes('Files');

/**
 * 拖放區。拖放與「選擇檔案」兩種方式都能完成（F-1.1）；
 * 手機沒有拖放，只顯示按鈕。不看檔名、不限副檔名，由解析模組判斷是不是蝦皮匯出檔。
 */
export default function Dropzone({ onFiles }: { onFiles: (files: File[]) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const depth = useRef(0);
  const [dragging, setDragging] = useState(false);

  const enter = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth.current++;
    setDragging(true);
  };
  const leave = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    depth.current = Math.max(0, depth.current - 1);
    if (depth.current === 0) setDragging(false);
  };
  const over = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };
  const drop = (e: DragEvent) => {
    e.preventDefault();
    depth.current = 0;
    setDragging(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) onFiles(files);
  };

  return (
    <div
      onDragEnter={enter} onDragLeave={leave} onDragOver={over} onDrop={drop}
      className={`flex flex-col items-center gap-3 rounded-lg px-4 py-8 text-center md:py-10 ${
        dragging ? 'border-2 border-solid border-brand bg-brand-soft' : 'border-2 border-dashed border-disabled bg-white'}`}
    >
      <Upload size={28} className={dragging ? 'text-brand' : 'text-muted'} aria-hidden="true" />
      <p className="hidden text-base font-medium md:block">{dragging ? '放開滑鼠加入檔案' : '把檔案拖到這裡'}</p>
      <div className="flex items-center gap-2">
        <span className="hidden text-sm text-muted md:inline">或</span>
        <button type="button" onClick={() => input.current?.click()} className={btnOutline}>選擇檔案</button>
      </div>
      <p className="text-xs text-muted">支援 .xlsx，可一次選多個，不用管檔名和順序</p>
      <input
        ref={input} type="file" multiple accept=".xlsx" className="sr-only" tabIndex={-1} aria-hidden="true"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = ''; // 同一個檔案移除後可以再放一次
          if (files.length > 0) onFiles(files);
        }}
      />
    </div>
  );
}
