/**
 * 解析模組含 SheetJS（打包約 655 KB），只在進入匯入精靈時才載入，不進主 bundle。
 * 這個檔案之外，請只用 `import type` 引用 '../shopee-import'。
 */
export type ShopeeImportLib = typeof import('../shopee-import');

let pending: Promise<ShopeeImportLib> | null = null;

export function loadShopeeImport(): Promise<ShopeeImportLib> {
  if (pending === null) {
    pending = import('../shopee-import').catch((e: unknown) => {
      pending = null; // 載入失敗（離線等）時，下次可以重試
      throw e;
    });
  }
  return pending;
}
