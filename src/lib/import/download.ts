/** 觸發瀏覽器下載。object URL 在下一個 tick 之後才釋放，避免 Safari 還沒開始讀就被收掉 */
export function downloadBytes(fileName: string, bytes: Uint8Array, mime: string): void {
  const blob = new Blob([bytes as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const ZIP_MIME = 'application/zip';

/** 失敗原因檔的 zip 檔名：失敗原因_{蝦皮店家 ID}_{yyyyMMdd-HHmm}.zip（design-t1 2.2） */
export function failureZipName(externalShopId: string, now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}`;
  return `失敗原因_${externalShopId}_${stamp}.zip`;
}
