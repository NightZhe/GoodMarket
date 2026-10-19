import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink } from 'lucide-react';
import { CONTACT_EMAIL, DELETION_WINDOW, PRIVACY_EFFECTIVE, PRIVACY_FIRST_PUBLISHED } from '../../lib/site';

/** 帳號頁 P-A（個人檔案、地址簿）上線日：已發生的修訂，不會再變 */
const PRIVACY_P_A = '2026/10/18';
const TURNSTILE_PRIVACY_URL = 'https://www.cloudflare.com/turnstile-privacy-policy/';

// 「付款資料」「收款帳戶」兩項與第 2～5 節的付款相關句子是設計稿 S-11 的草稿（綠界科技為官方名稱簡稱，合約上的正式公司名稱、
// 保存期限的數字、生效日期與修訂紀錄都待使用者確認）；「不會儲存完整卡號」要等 AC-E8 驗收通過後才能上線。
const DATA: { name: string; detail: ReactNode }[] = [
  { name: '登入帳號', detail: '帳號識別碼，以及你選用的登入方式提供的資料：用 Google 或 Apple 登入時是它們提供的電子郵件（如果 Apple 讓你選「隱藏我的電子郵件」，我們收到的是轉寄信箱，不是你的真實 email）；用手機號碼登入或綁定手機時是你的手機號碼。' },
  { name: '驗證碼簡訊', detail: '用手機號碼登入或綁定手機時，驗證碼簡訊由簡訊服務商 Twilio（位於美國）代為傳送，它會處理你的手機號碼與簡訊內容。' },
  {
    name: '安全驗證',
    detail: (
      <>
        為了防止機器人大量要求簡訊，傳送驗證碼前會經過 Cloudflare Turnstile 安全驗證，它會處理你的 IP 位址與瀏覽器資訊。詳見
        <a
          href={TURNSTILE_PRIVACY_URL} target="_blank" rel="noopener noreferrer"
          className="-my-3 inline-flex min-h-11 items-center gap-0.5 px-0.5 text-ink underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          Cloudflare Turnstile 隱私說明
          <ExternalLink size={12} aria-hidden="true" />
          <span className="sr-only">（另開新分頁）</span>
        </a>
        。
      </>
    ),
  },
  { name: 'Google 名稱與大頭貼網址', detail: '用 Google 登入時，登入服務（Supabase）會自動一併儲存。我們不會在畫面上顯示大頭貼。' },
  { name: '購物車', detail: '你加入購物車的商品、規格與數量，跟著帳號保存，換手機也看得到。' },
  { name: '收件地址', detail: '你存在「我的地址」裡的收件人姓名、手機與地址，以及每筆訂單當下使用的那一組。跟著帳號保存，你可以隨時刪除；刪除帳號時一併刪除。' },
  {
    name: '付款資料（信用卡）',
    detail: '你綁定信用卡時，卡號、有效期限與安全碼只輸入在綠界科技的畫面，由綠界科技保管，好物集不會收到，也不會儲存完整卡號。好物集只保存綠界科技給的綁卡代碼、卡別、卡號前六碼與後四碼、有效年月，以及你設定的預設卡，用來顯示你的卡片，並在你按下付款時向綠界科技發出扣款請求。你可以隨時刪除卡片。',
  },
  {
    name: '收款帳戶（賣家）',
    detail: '有開店的賣家在綠界科技開通收款：身分證件與銀行帳戶資料只提供給綠界科技，好物集不會收到，也不會儲存完整銀行帳號。好物集只保存你的特約商店編號、開通狀態、被退回的原因，以及每筆訂單的請款與撥款狀態。',
  },
  { name: '訂單', detail: '你的訂單內容、金額、狀態與物流進度，以及線上付款的付款狀態、時間與綠界科技的交易編號。' },
  { name: '暱稱', detail: '你在「個人檔案」設定的暱稱，只用來在寫評價時預填，不會公開顯示。' },
  { name: '評價', detail: '你寫的星等、文字、照片與暱稱。' },
];

/** 隱私政策 #/privacy。日期、保存期間、信箱集中在 lib/site.ts */
export default function Privacy() {
  return (
    <div className="mx-auto max-w-3xl md:px-4 md:pt-6">
      <article className="bg-white px-4 py-6 md:rounded-md md:p-10">
        <h1 className="text-2xl font-bold">隱私政策</h1>
        <p className="mt-1 text-xs text-muted">生效日期：{PRIVACY_EFFECTIVE}（修訂紀錄在文末）</p>
        <p className="mt-4 text-base leading-7">
          好物集是讓人開店、也讓人購物的網站。要購買商品，你需要用 Google、Apple 或手機號碼登入；這份政策說明我們收集哪些資料、怎麼使用、誰看得到、保存多久，以及你怎麼請我們刪除。
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
          <li>你按下付款時，向綠界科技請求用你選的卡付款；款項由綠界科技處理並撥給賣家。</li>
          <li>賣家開通收款時，用特約商店編號與狀態判斷買家能不能用信用卡向這家店付款。</li>
          <li>寫評價時，暱稱會先預填你在個人檔案設定的暱稱；沒設定時，預填你的 Google 名稱。你可以自行修改或清空，改的只影響那則評價。</li>
        </ul>

        <h2 className="mt-8 text-base font-bold">3. 誰看得到</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-base leading-7">
          <li>你下單的賣家只看得到那張訂單用的收件資料、訂單編號，以及你評價時填的完整暱稱；看不到你「我的地址」裡的其他地址。</li>
          <li>綠界科技：為了處理付款與綁卡，會收到卡片資料（只在綠界科技的畫面輸入）、付款金額與訂單編號。</li>
          <li>你下單的賣家看得到訂單是否已付款，看不到你的卡片資料。</li>
          <li>其他人只看得到遮罩後的暱稱（例如「王*****明」）。</li>
          <li>我們不會公開你的電子郵件、手機號碼與帳號識別碼。</li>
          <li>我們不會把你登入用的手機號碼提供給賣家；賣家看到的是你下單時填寫的收件人電話。</li>
          <li>你在個人檔案設定的暱稱，不會顯示在任何公開的地方。</li>
        </ul>

        <h2 className="mt-8 text-base font-bold">4. 保存多久</h2>
        <p className="mt-2 text-base leading-7">
          你的帳號存在期間，我們會保存帳號、購物車、收件地址、暱稱與評價等資料。你申請刪除帳號後，我們會在 {DELETION_WINDOW}刪除或去識別化你的個人資料，已公開的評價會改為「匿名買家」顯示。你刪除信用卡時，好物集會刪除顯示用的卡片資料，並通知綠界科技撤銷綁定。訂單等交易紀錄（含付款紀錄），依相關法規規定的期間保存。
        </p>

        <h2 className="mt-8 text-base font-bold">5. 刪除你的資料</h2>
        <p className="mt-2 text-base leading-7">
          收件地址可以隨時在「我的帳號 › 地址」刪除；信用卡可以隨時在「我的帳號 › 付款方式」刪除；暱稱可以在「個人檔案」清空。
        </p>
        <div className="mt-2 rounded-md border border-line bg-subtle p-4 text-base leading-7">
          要刪除整個帳號，目前請來信申請，我們會人工處理。有開店的帳號請在信中註明，我們會另外與你確認處理方式。
        </div>

        <h2 className="mt-8 text-base font-bold">6. 聯絡我們</h2>
        <p className="mt-2 text-base leading-7">
          關於你的資料有任何問題，請來信：
          <a href={`mailto:${CONTACT_EMAIL}`} className="underline underline-offset-2">{CONTACT_EMAIL}</a>
        </p>

        <h2 className="mt-8 text-base font-bold">7. 修訂紀錄</h2>
        <dl className="mt-2 rounded-md border border-line px-4">
          <div className="border-t border-line py-3 first:border-t-0">
            <dt className="text-sm font-medium tabular-nums">{PRIVACY_EFFECTIVE}</dt>
            <dd className="mt-0.5 text-sm leading-6 text-muted">
              新增手機號碼登入與綁定手機：說明手機號碼的用途、驗證碼簡訊由 Twilio 傳送、傳送前會經過 Cloudflare Turnstile 安全驗證，以及登入用的手機號碼不會提供給賣家。登入方式的說明改為 Google、Apple、手機號碼三種。
            </dd>
          </div>
          <div className="border-t border-line py-3">
            <dt className="text-sm font-medium tabular-nums">{PRIVACY_P_A}</dt>
            <dd className="mt-0.5 text-sm leading-6 text-muted">新增「我的帳戶」：個人檔案暱稱與地址簿的用途、保存與刪除方式；賣家只看得到訂單用的那一組收件資料。</dd>
          </div>
          <div className="border-t border-line py-3">
            <dt className="text-sm font-medium tabular-nums">{PRIVACY_FIRST_PUBLISHED}</dt>
            <dd className="mt-0.5 text-sm leading-6 text-muted">首次發佈（Google、Apple 登入）。</dd>
          </div>
        </dl>

        <Link to="/" className="mt-8 inline-flex min-h-11 items-center text-sm underline underline-offset-2">回首頁</Link>
      </article>
    </div>
  );
}
