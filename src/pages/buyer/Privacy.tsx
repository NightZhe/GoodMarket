import { Link } from 'react-router-dom';
import { CONTACT_EMAIL, DELETION_WINDOW, PRIVACY_EFFECTIVE } from '../../lib/site';

const DATA: { name: string; detail: string }[] = [
  { name: '登入帳號', detail: '帳號識別碼與電子郵件。你用 Google 或 Apple 登入時，由它們提供；如果 Apple 讓你選「隱藏我的電子郵件」，我們收到的是轉寄信箱，不是你的真實 email。' },
  { name: 'Google 名稱與大頭貼網址', detail: '用 Google 登入時，登入服務（Supabase）會自動一併儲存。我們不會在畫面上顯示大頭貼。' },
  { name: '購物車', detail: '你加入購物車的商品、規格與數量，跟著帳號保存，換手機也看得到。' },
  { name: '收件資料', detail: '下單時填寫的收件人姓名、電話與地址。' },
  { name: '訂單', detail: '你的訂單內容、金額、狀態與物流進度。' },
  { name: '評價', detail: '你寫的星等、文字、照片與暱稱。' },
];

/** 隱私政策 #/privacy。日期、保存期間、信箱集中在 lib/site.ts */
export default function Privacy() {
  return (
    <div className="mx-auto max-w-3xl md:px-4 md:pt-6">
      <article className="bg-white px-4 py-6 md:rounded-md md:p-10">
        <h1 className="text-2xl font-bold">隱私政策</h1>
        <p className="mt-1 text-xs text-muted">生效日期：{PRIVACY_EFFECTIVE}</p>
        <p className="mt-4 text-base leading-7">
          好物集是讓人開店、也讓人購物的網站。要購買商品，你需要用 Google 或 Apple 登入；這份政策說明我們收集哪些資料、怎麼使用、誰看得到、保存多久，以及你怎麼請我們刪除。
        </p>

        <h2 className="mt-8 text-base font-bold">1. 我們收集的資料</h2>
        <dl className="mt-2 rounded-md border border-line px-4">
          {DATA.map(d => (
            <div key={d.name} className="border-t border-line py-3 first:border-t-0">
              <dt className="text-sm font-medium">{d.name}</dt>
              <dd className="mt-0.5 text-sm leading-6 text-muted">{d.detail}</dd>
            </div>
          ))}
        </dl>

        <h2 className="mt-8 text-base font-bold">2. 怎麼使用</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-base leading-7">
          <li>讓你登入、保存購物車、下單、查詢訂單與撰寫評價。</li>
          <li>把收件資料交給你下單的賣家，讓賣家出貨。</li>
          <li>Google 名稱會預填為評價暱稱，你可以自行修改或清空。</li>
        </ul>

        <h2 className="mt-8 text-base font-bold">3. 誰看得到</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-base leading-7">
          <li>你下單的賣家看得到收件資料、訂單編號，以及你評價時填的完整暱稱。</li>
          <li>其他人只看得到遮罩後的暱稱（例如「王*****明」）。</li>
          <li>我們不會公開你的電子郵件與帳號識別碼。</li>
        </ul>

        <h2 className="mt-8 text-base font-bold">4. 保存多久</h2>
        <p className="mt-2 text-base leading-7">
          你的帳號存在期間，我們會保存帳號、購物車與評價等資料。你申請刪除帳號後，我們會在 {DELETION_WINDOW}刪除或去識別化你的個人資料，已公開的評價會改為「匿名買家」顯示。訂單等交易紀錄，依相關法規規定的期間保存。
        </p>

        <h2 className="mt-8 text-base font-bold">5. 刪除你的資料</h2>
        <div className="mt-2 rounded-md border border-line bg-subtle p-4 text-base leading-7">
          目前請來信申請刪除帳號，我們會人工處理。有開店的帳號請在信中註明，我們會另外與你確認處理方式。
        </div>

        <h2 className="mt-8 text-base font-bold">6. 聯絡我們</h2>
        <p className="mt-2 text-base leading-7">
          關於你的資料有任何問題，請來信：
          <a href={`mailto:${CONTACT_EMAIL}`} className="underline underline-offset-2">{CONTACT_EMAIL}</a>
        </p>

        <Link to="/" className="mt-8 inline-flex min-h-11 items-center text-sm underline underline-offset-2">回首頁</Link>
      </article>
    </div>
  );
}
