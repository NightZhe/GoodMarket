// 分享出去的網址一律是正式站（decisions D-7b）：App 內 window.location 是 capacitor://nightzhe.github.io/…，
// 別人點了打不開；網頁版自己就在正式站，用 location.href 即可（本機開發時分享的也是正式站網址，刻意的）。
// 2026-11-25 起對外網址是 goodmshop.com（Cloudflare Workers 另外部署的同一份網站）；舊網址 nightzhe.github.io/GoodMarket 仍可用。
// 注意：這裡只管「給人點的連結」。App 的 WebView hostname 與 Turnstile iframe 仍必須是 nightzhe.github.io，不要一起改。

export const PUBLIC_SITE = 'https://goodmshop.com/';

/** 站內路由（'/product/p1'）→ 'https://goodmshop.com/#/product/p1' */
export function publicUrl(route: string): string {
  const r = route.startsWith('/') ? route : `/${route}`;
  return `${PUBLIC_SITE}#${r}`;
}
