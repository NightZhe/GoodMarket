// 水平玻璃膠囊群組（GlassGroup）的寬度與「放不放得下」判斷（純函式，無畫面）。數字與 index.css 的 .glass-group 一致。

/** 一格的邊長（熱區 44×44） */
export const GROUP_CELL = 44;
/** 分隔槽寬（內有 0.5px 細線） */
export const GROUP_SEPARATOR = 2;

export const groupWidth = (cells: number, separators: number): number => cells * GROUP_CELL + separators * GROUP_SEPARATOR;

/**
 * 可用寬放不下整組就收成「⋯」（C1＝a）。room＝群組在列裡實際分到的寬度（已扣左鈕與間距）；量不到（Infinity）先當放得下，第一幀不閃。
 * forceCollapse：呼叫端要求一律收合（例如方案 B 的三頁）。
 */
export const shouldCollapse = (room: number, width: number, forceCollapse = false): boolean => forceCollapse || room < width;
