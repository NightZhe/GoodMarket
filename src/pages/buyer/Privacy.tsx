import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink } from 'lucide-react';
import { usePaymentConfig } from '../../lib/payment/usePaymentConfig';
import { CONTACT_EMAIL, DELETION_WINDOW, PRIVACY_EFFECTIVE, PRIVACY_FIRST_PUBLISHED } from '../../lib/site';

/** 刪除帳號改為申請制、新增內容審核與檢舉的修訂日（store-prereqs，2026-10-26 推上）：已發生的修訂，不會再變。
 *  聊聊上線那筆（2026/10/29）接手 PRIVACY_EFFECTIVE，這筆依合併規則改成固定日期 */
const PRIVACY_DELETE_REQUEST = '2026/10/26';
/** 帳號頁 P-A（個人檔案、地址簿）上線日：已發生的修訂，不會再變 */
const PRIVACY_P_A = '2026/10/18';
/** 賣家『物流設定』（退貨收件資料的揭露）上線日：已發生的修訂，不會再變。
 *  修訂紀錄的合併規則：同一天上線的修訂若有多筆，只有最新一筆用 PRIVACY_EFFECTIVE，其餘改成固定日期常數；
 *  PR #8（簡訊商改 MAAC Go）與本檔同樣把這筆改成這個常數，並也在最上面加一筆用 PRIVACY_EFFECTIVE 的修訂，
 *  後合併者合併時保留兩筆、把先合併者那筆的日期改成固定常數（日期＝對方實際推前端那天） */
const PRIVACY_SELLER_LOGISTICS = '2026/10/25';
/** 驗證碼簡訊服務商改為 MAAC Go（三竹備援）的修訂日（PR #8，2026-10-25 深夜推上、網站顯示 2026/10/26）：已發生的修訂，不會再變 */
const PRIVACY_SMS_MAACGO = '2026/10/26';
/** 銀行帳號上線那筆（2026/10/29，與聊聊同日）：聊聊那筆是最新一筆用 PRIVACY_EFFECTIVE，這筆依合併規則用固定日期。只在線上付款開關打開時顯示（銀行帳號功能隨開關） */
const PRIVACY_BANK_ACCOUNT = '2026/10/29';
/** 驗證碼簡訊服務商由 Twilio 改為三竹的修訂日：已發生的修訂，不會再變（修訂紀錄的「最新一筆」用 PRIVACY_EFFECTIVE，舊的每筆各有自己的固定日期） */
const PRIVACY_SMS_VENDOR = '2026/10/20';
/** 手機號碼登入與綁定手機上線日：已發生的修訂，不會再變 */
const PRIVACY_PHONE_LOGIN = '2026/10/19';
/** 銀行帳號功能的修訂紀錄句子（只在線上付款開關打開時顯示；句子本身仍不含付款字樣） */
export const BANK_REVISION = '新增「銀行帳號」：說明綁定的銀行帳號如何保存、誰看得到，以及刪除帳號時如何處理。';
const TURNSTILE_PRIVACY_URL = 'https://www.cloudflare.com/turnstile-privacy-policy/';

// 「付款資料」「收款帳戶」兩項與第 2～5 節的付款相關句子是設計稿 S-11 的草稿（綠界科技為官方名稱簡稱，合約上的正式公司名稱、
// 保存期限的數字、生效日期與修訂紀錄都待使用者確認）；「不會儲存完整卡號」要等 AC-E8 驗收通過後才能上線。
const dataItems = (payOn: boolean): { name: string; detail: ReactNode }[] => [
  { name: '登入帳號', detail: '帳號識別碼，以及你選用的登入方式提供的資料：用 Google 或 Apple 登入時是它們提供的電子郵件（如果 Apple 讓你選「隱藏我的電子郵件」，我們收到的是轉寄信箱，不是你的真實 email）；用手機號碼登入或綁定手機時是你的手機號碼。' },
  { name: '驗證碼簡訊', detail: '用手機號碼登入或綁定手機時，驗證碼簡訊由簡訊服務商漸強實驗室股份有限公司（MAAC Go，位於台灣）代為傳送，它會處理你的手機號碼與簡訊內容。如果 MAAC Go 暫時無法傳送，會改由三竹資訊股份有限公司（位於台灣）代為傳送，處理的資料相同。' },
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
  ...(payOn ? [{
    name: '付款資料（信用卡）',
    detail: '你綁定信用卡時，卡號、有效期限與安全碼只輸入在綠界科技的畫面，由綠界科技保管，好物集不會收到，也不會儲存完整卡號。好物集只保存綠界科技給的綁卡代碼、卡別、卡號前六碼與後四碼、有效年月，以及你設定的預設卡，用來顯示你的卡片，並在你按下付款時向綠界科技發出扣款請求。你可以隨時刪除卡片。',
  }, {
    name: '銀行帳號',
    detail: (
      <>
        你在「銀行帳號／信用卡」綁定的銀行代碼、分行代碼、銀行帳號與戶名，用來在你開店收款時把貨款撥給你。完整銀行帳號以加密方式保存，畫面上只顯示銀行名稱與帳號末四碼；只有撥款流程會解密使用，你本人與其他使用者都無法從網站或 App 讀取完整帳號。我們也保存每個帳號的驗證狀態、未通過的原因，以及每次新增、刪除或更換撥款帳號的時間與帳號末四碼，用來處理帳號遭盜用的爭議。
        <br />
        新增第二個以上的銀行帳號或更換撥款帳號時，我們會傳送驗證碼簡訊到你帳號上綁定的手機，簡訊服務商同「驗證碼簡訊」一項。
      </>
    ),
  }] : []),
  { name: '訂單', detail: payOn ? '你的訂單內容、金額、狀態與物流進度，以及線上付款的付款狀態、時間與綠界科技的交易編號。' : '你的訂單內容、金額、狀態與物流進度。' },
  { name: '暱稱', detail: '你在「個人檔案」設定的暱稱，只用來在寫評價時預填，不會公開顯示。' },
  { name: '評價', detail: '你寫的星等、文字、照片與暱稱。' },
  { name: '檢舉紀錄', detail: '你檢舉時選的原因、說明、被檢舉的內容與時間，跟著你的帳號識別碼保存，用來處理檢舉與防止濫用；不會提供給被檢舉的一方。' },
];

/** 隱私政策 #/privacy。日期、保存期間、信箱集中在 lib/site.ts。付款相關的段落隨線上付款開關顯示（關著時與上線前逐字相同） */
export default function Privacy() {
  return <PrivacyView payOn={usePaymentConfig().enabled} />;
}

export function PrivacyView({ payOn }: { payOn: boolean }) {
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
          {dataItems(payOn).map(d => (
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
          {payOn && <li>你按下付款時，向綠界科技請求用你選的卡付款；款項由綠界科技處理並撥給賣家。</li>}
          <li>寫評價時，暱稱會先預填你在個人檔案設定的暱稱；沒設定時，預填你的 Google 名稱。你可以自行修改或清空，改的只影響那則評價。</li>
        </ul>

        <h2 className="mt-8 text-base font-bold">3. 誰看得到</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-base leading-7">
          <li>你下單的賣家只看得到那張訂單用的收件資料、訂單編號，以及你評價時填的完整暱稱；看不到你「我的地址」裡的其他地址。</li>
          {payOn && <li>綠界科技：為了處理付款與綁卡，會收到卡片資料（只在綠界科技的畫面輸入）、付款金額與訂單編號。</li>}
          {payOn && <li>你下單的賣家看得到訂單是否已付款，看不到你的卡片資料。</li>}
          {payOn && <li>你的銀行帳號不會顯示給買家或其他賣家。</li>}
          <li>有開店的賣家在『物流設定』填的退貨收件資料（收件人姓名、手機、退貨門市或地址、退貨說明），會顯示給向這家店購買、且訂單已出貨或已完成的買家；賣場頁與商品頁不會顯示。</li>
          <li>其他人只看得到遮罩後的暱稱（例如「王*****明」）。</li>
          <li>我們不會公開你的電子郵件、手機號碼與帳號識別碼。</li>
          <li>我們不會把你登入用的手機號碼提供給賣家；賣家看到的是你下單時填寫的收件人電話。</li>
          <li>你在個人檔案設定的暱稱，不會顯示在任何公開的地方。</li>
        </ul>

        <h2 className="mt-8 text-base font-bold">4. 保存多久</h2>
        <p className="mt-2 text-base leading-7">
          你的帳號存在期間，我們會保存帳號、購物車、收件地址、暱稱與評價等資料。你申請刪除帳號後，我們會在 {DELETION_WINDOW}刪除或去識別化你的個人資料，你寫的評價與照片會一併刪除。{payOn && '刪除帳號時，我們會先請綠界科技刪除你綁定的所有信用卡。你刪除信用卡時，好物集會刪除顯示用的卡片資料，並通知綠界科技撤銷綁定。刪除帳號時，你綁定的銀行帳號一併刪除。'}訂單等交易紀錄{payOn ? '（含付款紀錄）' : ''}，依相關法規規定的期間保存。我們會保留刪除申請的處理紀錄（申請、完成日期與已刪除帳號的識別碼），以及你檢舉過的內容紀錄（不含你的身分）。
        </p>

        <h2 className="mt-8 text-base font-bold">5. 刪除你的資料</h2>
        <p className="mt-2 text-base leading-7">
          收件地址可以隨時在「我的帳號 › 地址」刪除；{payOn && '信用卡與銀行帳號可以隨時在「我的帳號 › 銀行帳號／信用卡」刪除（撥款帳號要先把別的帳號設為撥款帳號才能刪）；'}暱稱可以在「個人檔案」清空。
        </p>
        <div className="mt-2 rounded-md border border-line bg-subtle p-4 text-base leading-7">
          要刪除整個帳號，請在 App 或網站的『我的 › 刪除帳號』提出申請，也可以直接從這裡
          <Link
            to="/account/delete"
            className="-my-3 inline-flex min-h-11 items-center px-0.5 text-ink underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            申請刪除帳號
          </Link>
          。我們會在申請後 {DELETION_WINDOW}人工處理；處理完成前你可以隨時取消。還有待出貨或運送中的訂單時，要等訂單完成或取消後才能申請。有開店的帳號，店、商品與店內的訂單會一併刪除。刪除完成後，再用同一個登入方式登入會是全新的空帳號。聊聊對話不隨帳號刪除而刪除，你的名稱改顯示為『已刪除的帳號』。
        </div>

        <h2 className="mt-8 text-base font-bold">6. 內容審核與檢舉</h2>
        <p className="mt-2 text-base leading-7">
          好物集上的商品、評價與照片由使用者刊登。我們以人工方式審核，發現或收到檢舉的違規內容（例如違禁品、仿冒品、詐騙、色情暴力、騷擾或洩露個人資料）會下架或移除。每個商品、評價與店家都可以按『檢舉』告訴我們，我們會在 2 個工作天內處理，不會讓被檢舉的一方知道是誰檢舉。你也可以在店家頁封鎖店家：封鎖只記在你這台裝置上，被封鎖店家的商品不會再出現在首頁與搜尋結果。其他問題請來信{' '}
          <a href={`mailto:${CONTACT_EMAIL}`} className="underline underline-offset-2">{CONTACT_EMAIL}</a>
          。
        </p>

        <h2 className="mt-8 text-base font-bold">7. 聊聊</h2>
        <p className="mt-2 text-base leading-7">
          <strong className="font-semibold">聊聊訊息</strong>：你與店家在站內的對話內容（文字、圖片、商品與訂單卡片）會儲存在我們的資料庫與檔案儲存空間，用於提供對話功能與處理交易糾紛。對話不會自動刪除；你刪除帳號後，對方仍看得到既有對話，但你的名稱會顯示為『已刪除的帳號』。圖片只有對話雙方看得到。我們不會將對話內容用於廣告。
        </p>

        <h2 className="mt-8 text-base font-bold">8. 聯絡我們</h2>
        <p className="mt-2 text-base leading-7">
          關於你的資料有任何問題，請來信：
          <a href={`mailto:${CONTACT_EMAIL}`} className="underline underline-offset-2">{CONTACT_EMAIL}</a>
        </p>

        <h2 className="mt-8 text-base font-bold">9. 修訂紀錄</h2>
        <dl className="mt-2 rounded-md border border-line px-4">
          <div className="border-t border-line py-3 first:border-t-0">
            <dt className="text-sm font-medium tabular-nums">{PRIVACY_EFFECTIVE}</dt>
            <dd className="mt-0.5 text-sm leading-6 text-muted">新增『聊聊』：說明站內對話內容的儲存、保留與刪帳號後的顯示方式。</dd>
          </div>
          {payOn && (
            <div className="border-t border-line py-3">
              <dt className="text-sm font-medium tabular-nums">{PRIVACY_BANK_ACCOUNT}</dt>
              <dd className="mt-0.5 text-sm leading-6 text-muted">{BANK_REVISION}</dd>
            </div>
          )}
          <div className="border-t border-line py-3">
            <dt className="text-sm font-medium tabular-nums">{PRIVACY_DELETE_REQUEST}</dt>
            <dd className="mt-0.5 text-sm leading-6 text-muted">刪除帳號改為在 App 或網站提出申請、7 個工作天內處理，刪除時評價與照片一併刪除；新增『內容審核與檢舉』與檢舉紀錄的說明。</dd>
          </div>
          <div className="border-t border-line py-3">
            <dt className="text-sm font-medium tabular-nums">{PRIVACY_SMS_MAACGO}</dt>
            <dd className="mt-0.5 text-sm leading-6 text-muted">驗證碼簡訊服務商由三竹資訊股份有限公司改為漸強實驗室股份有限公司（MAAC Go，位於台灣）；三竹資訊改為備援，只在 MAAC Go 暫時無法傳送時使用。</dd>
          </div>
          <div className="border-t border-line py-3">
            <dt className="text-sm font-medium tabular-nums">{PRIVACY_SELLER_LOGISTICS}</dt>
            <dd className="mt-0.5 text-sm leading-6 text-muted">新增賣家『物流設定』：說明賣家的退貨收件資料會顯示給哪些買家。</dd>
          </div>
          <div className="border-t border-line py-3">
            <dt className="text-sm font-medium tabular-nums">{PRIVACY_SMS_VENDOR}</dt>
            <dd className="mt-0.5 text-sm leading-6 text-muted">驗證碼簡訊服務商由 Twilio 改為三竹資訊股份有限公司（位於台灣）。</dd>
          </div>
          <div className="border-t border-line py-3">
            <dt className="text-sm font-medium tabular-nums">{PRIVACY_PHONE_LOGIN}</dt>
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
