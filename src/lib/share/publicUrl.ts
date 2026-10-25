// 分享出去的網址一律是正式站（decisions D-7b）：App 內 window.location 是 capacitor://nightzhe.github.io/…，
// 別人點了打不開；網頁版自己就在正式站，用 location.href 即可（本機開發時分享的也是正式站網址，刻意的）。

export const PUBLIC_SITE = 'https://nightzhe.github.io/GoodMarket/';

/** 站內路由（'/product/p1'）→ 'https://nightzhe.github.io/GoodMarket/#/product/p1' */
export function publicUrl(route: string): string {
  const r = route.startsWith('/') ? route : `/${route}`;
  return `${PUBLIC_SITE}#${r}`;
}
