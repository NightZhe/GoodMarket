import { Link } from 'react-router-dom';
import { CONTACT_EMAIL, DELETION_WINDOW, PRIVACY_EFFECTIVE } from '../../lib/site';

const DATA: { name: string; detail: string }[] = [
  { name: '登入帳號', detail: '帳號識別碼與電子郵件。你用 Google 或 Apple 登入時，由它們提供；如果 Apple 讓你選「隱藏我的電子郵件」，我們收到的是轉寄信箱，不是你的真實 email。' },
  { name: 'Google 名稱與大頭貼網址', detail: '用 Google 登入時，登入服務（Supabase）會自動一併儲存。我們不會在畫面上顯示大頭貼。' },
  { name: '購物車', detail: '你加入購物車的商品、規格與數量，跟著帳號保存，換手機也看得到。' },
  { name: '收件地址', detail: '你存在「我的地址」裡的收件人姓名、手機與地址，以及每筆訂單當下使用的那一組。跟著帳號保存，你可以隨時刪除；刪除帳號時一併刪除。' },
  { name: '訂單', detail: '你的訂單內容、金額、狀態與物流進度。' },
  { name: '暱稱', detail: '你在「個人檔案」設定的暱稱，只用來在寫評價時預填，不會公開顯示。' },
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
          <li>讓你登入、保存購物車與收件地址、下單、查詢訂單與撰寫評價。</li>
          <li>下單時，把你選的那一筆收件資料交給你下單的賣家，讓賣家出貨。</li>
          <li>寫評價時，暱稱會先預填你在個人檔案設定的暱稱；沒設定時，預填你的 Google 名稱。你可以自行修改或清空，改的只影響那則評價。</li>
        </ul>

        <h2 className="mt-8 text-base font-bold">3. 誰看得到</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-base leading-7">
          <li>你下單的賣家只看得到那張訂單用的收件資料、訂單編號，以及你評價時填的完整暱稱；看不到你「我的地址」裡的其他地址。</li>
          <li>其他人只看得到遮罩後的暱稱（例如「王*****明」）。</li>
          <li>我們不會公開你的電子郵件與帳號識別碼。</li>
          <li>你在個人檔案設定的暱稱，不會顯示在任何公開的地方。</li>
        </ul>

        <h2 className="mt-8 text-base font-bold">4. 保存多久</h2>
        <p className="mt-2 text-base leading-7">
          你的帳號存在期間，我們會保存帳號、購物車、收件地址、暱稱與評價等資料。你申請刪除帳號後，我們會在 {DELETION_WINDOW}刪除或去識別化你的個人資料，已公開的評價會改為「匿名買家」顯示。訂單等交易紀錄，依相關法規規定的期間保存。
        </p>

        <h2 className="mt-8 text-base font-bold">5. 刪除你的資料</h2>
        <p className="mt-2 text-base leading-7">
          收件地址可以隨時在「我的帳號 › 地址」刪除；暱稱可以在「個人檔案」清空。
        </p>
        <div className="mt-2 rounded-md border border-line bg-subtle p-4 text-base leading-7">
          要刪除整個帳號，目前請來信申請，我們會人工處理。有開店的帳號請在信中註明，我們會另外與你確認處理方式。
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
