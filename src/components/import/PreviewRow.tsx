import { CATEGORIES } from '../../data/seed';
import { money } from '../../lib/format';
import type { PreviewRow as Row, ProductIssue } from '../../lib/shopee-import/types';
import type { CategoryId } from '../../types';
import Cover from './Cover';
import Tag from './Tag';

/** 桌機欄寬：封面 56、商品 FILL、分類 144、規格 56、價格 112、庫存 64、動作 72、匯入後 88（design-t1 2.5） */
const GRID = 'md:grid-cols-[56px_minmax(0,1fr)_144px_56px_112px_64px_72px_88px]';

export function PreviewHeader() {
  return (
    <div aria-hidden="true" className={`hidden gap-3 bg-subtle px-4 py-2.5 text-xs text-muted md:grid ${GRID}`}>
      <span />
      <span>商品</span><span>好物集分類</span><span>規格</span><span>價格</span><span>庫存</span><span>動作</span><span>匯入後</span>
    </div>
  );
}

const ACTION_TEXT: Record<Row['action'], string> = { create: '新增', update: '更新', error: '錯誤', skip: '略過', done: '已完成' };

function afterText(row: Row, existingStatus: 'active' | 'hidden' | undefined): string {
  if (row.action === 'error' || row.action === 'skip' || row.afterStatus === null) return '—';
  if (row.action === 'done') return row.afterStatus === 'active' ? '上架中' : '下架中';
  if (row.action === 'create') return row.afterStatus === 'active' ? '上架' : '下架';
  if (row.afterStatus === 'hidden') return existingStatus === 'active' ? '改為下架' : '維持下架';
  return '維持上架';
}

const WARNING_TEXT: Record<string, (isCreate: boolean) => React.ReactNode> = {
  CATEGORY_OTHER: (isCreate) => isCreate
    ? <>分類對不上，先放在「其他」，可以在<span className="hidden md:inline">右邊</span><span className="md:hidden">下方</span>改。</>
    : '分類對不上，先歸在「其他」；這件商品已在好物集，分類維持原設定、不會變動。',
  LOOKS_LIKE_TOP_UP: () => '看起來像補差額／補價商品（名稱含「補差」「補價」或「補運」，或最低規格價低於 10 元）。',
  DESCRIPTION_OVER_EDITOR_LIMIT: () => '描述超過 3,000 字，會完整匯入；之後在編輯頁無法再加長。',
};

function Issues({ row }: { row: Row }) {
  const isCreate = row.action === 'create';
  const importable = row.action === 'create' || row.action === 'update';
  return (
    <div className="mt-1 space-y-1">
      {row.errors.map((e: ProductIssue) => (
        <p key={e.code + e.message} className="flex items-start gap-1.5 text-sm">
          <Tag kind="error" /><span className="min-w-0 break-words">{e.message}</span>
        </p>
      ))}
      {row.action === 'skip' && (
        <p className="flex items-start gap-1.5 text-sm">
          <Tag kind="info" /><span>已售完，已依你的設定略過</span>
        </p>
      )}
      {row.action === 'done' && (
        <p className="flex items-start gap-1.5 text-sm">
          <Tag kind="info" label="已完成" /><span>上次已經匯入完成，這次不會再處理</span>
        </p>
      )}
      {importable && row.warnings.map((w) => (
        <p key={w.code} className="flex items-start gap-1.5 text-sm">
          <Tag kind="warn" />
          <span className="min-w-0 break-words">{(WARNING_TEXT[w.code] ?? (() => w.message))(isCreate)}</span>
        </p>
      ))}
    </div>
  );
}

interface Props {
  row: Row;
  existingStatus?: 'active' | 'hidden';
  onCategory: (sourceProductId: string, categoryId: CategoryId) => void;
}

/**
 * 預覽的一列。桌機是八欄的表格列，手機是卡片（同一份 DOM，用 grid／contents 重排）。
 * 只有「將新增」的列可以改分類；將更新與上次已完成的列顯示「維持原設定」（R-1）。
 */
export default function PreviewRow({ row, existingStatus, onCategory }: Props) {
  const category = CATEGORIES.find((c) => c.id === row.categoryId);
  const prices = row.priceMin === null || row.priceMax === null ? '—'
    : row.priceMin === row.priceMax ? money(row.priceMin) : `${money(row.priceMin)}–${money(row.priceMax)}`;
  const bar = row.action === 'error' ? 'border-l-error-border' : row.action === 'skip' || row.action === 'done' ? 'border-l-disabled'
    : row.warnings.length > 0 ? 'border-l-warning' : 'border-l-transparent';

  return (
    <li className={`grid grid-cols-[56px_minmax(0,1fr)] items-start gap-x-3 gap-y-2 border-l-4 px-3 py-3 md:items-center md:px-3 ${GRID} ${bar} ${row.action === 'skip' || row.action === 'done' ? 'bg-subtle' : 'bg-white'}`}>
      <Cover src={row.coverUrl} />
      <div className="min-w-0">
        <p className="break-words text-sm font-medium">{row.title === '' ? '（沒有名稱）' : row.title}</p>
        <p className="text-xs text-muted tabular-nums">商品 ID {row.sourceProductId}</p>
        <Issues row={row} />
      </div>

      <div className="col-span-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm md:contents">
        <div className="basis-full md:basis-auto">
          {row.action === 'create' ? (
            <select
              aria-label={`「${row.title}」的好物集分類`} value={row.categoryId}
              onChange={(e) => onCategory(row.sourceProductId, e.target.value as CategoryId)}
              className="h-11 w-full rounded-sm border border-line bg-white px-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand md:h-8"
            >
              {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
            </select>
          ) : row.action === 'update' || row.action === 'done' ? (
            <span className="text-muted"><span className="md:hidden">分類：</span>維持原設定</span>
          ) : (
            <span className="text-muted"><span className="md:hidden">分類：</span>{category ? `${category.icon} ${category.name}` : '—'}</span>
          )}
        </div>
        <span className="tabular-nums"><span className="text-muted md:sr-only">規格 </span>{row.variantCount}<span className="md:hidden"> 個</span></span>
        <span className="tabular-nums"><span className="text-muted md:sr-only">價格 </span>{prices}</span>
        <span className="tabular-nums"><span className="text-muted md:sr-only">庫存 </span>{row.totalStock.toLocaleString('en-US')}</span>
        <span className="font-medium"><span className="text-muted md:sr-only">動作 </span>{ACTION_TEXT[row.action]}</span>
        <span><span className="text-muted md:sr-only">匯入後 </span>{afterText(row, existingStatus)}</span>
      </div>
    </li>
  );
}
