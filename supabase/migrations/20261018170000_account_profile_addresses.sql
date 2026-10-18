-- 帳號個人檔案（暱稱）＋地址簿（.work/account-payment-methods/spec.md v0.3，工單 A-T4；decisions.md D12～D17）
--
-- 只做相容的新增：三張新表（tw_districts、profiles、addresses）與六個新 RPC。
-- 不動任何既有的表、欄位、權限、函式；舊前端不讀這些，所以先套資料庫、再推前端都安全。
--
-- 存取方式：
--   · 讀：直接 select（PostgREST，RLS 限定本人）：from('profiles')、from('addresses')
--   · 寫：一律走 RPC（SECURITY DEFINER，內部用 auth.uid()）。兩張表都不 grant insert／update／delete 給 authenticated。
--     理由：「設為預設」要在同一個交易裡「取消舊預設＋設新預設」、上限 10 筆與唯一預設要在競爭下也成立、
--     手機要正規化成 10 碼數字、郵遞區號要和縣市／區核對；這些不能交給前端分好幾個 request 拼起來。
--   · 帳號版 RPC 開給 anon（慣例同 buyer_accounts_m1）：session 過期時得到中文的 NOT_AUTHENTICATED，而不是英文的 permission denied。
--
-- 錯誤格式沿用既有慣例：raise exception '<中文說明>' using hint = '<錯誤碼>'
--   （supabase-js 的 error.message＝中文說明、error.hint＝機器代碼）。錯誤碼對照表見 .work/account-payment-methods/interface.md。
--
-- 外鍵：profiles.user_id、addresses.user_id 對 auth.users(id) 一律 ON DELETE CASCADE
--   （手機登入那條線會直接刪 auth.users 的列；刪帳號工具也靠它）。
-- 不在 auth.users 上建 trigger：profiles 的列在第一次存暱稱時才建（set_my_nickname 是 upsert）。
-- 可重複執行。

-- ═══════════════════════════════════════════════════════════════════════
-- 1. 行政區清單（資料庫端的驗證來源）
-- ═══════════════════════════════════════════════════════════════════════
-- 前後端共用同一份來源：scripts/gen-tw-districts.mts 從中華郵政的檔案同時產生 src/data/tw-districts.json 與下面的 GENERATED 區塊，
-- 一致性測試見 src/data/tw-districts.test.ts。同一個 3 碼可能對到好幾個區（新竹市 3 區共用 300、嘉義市 2 區共用 600），
-- 所以主鍵是 (縣市, 區)，只能「由區帶出郵遞區號」。
-- 不放前端讀的權限：前端用 JSON 檔（讀不到資料庫時結帳頁也要能選）；這張表只給伺服器端驗證用。
create table if not exists public.tw_districts (
  city        text not null,
  district    text not null,
  postal_code text not null check (postal_code ~ '^[0-9]{3}$'),
  primary key (city, district)
);
alter table public.tw_districts enable row level security;
revoke all on public.tw_districts from public, anon, authenticated;

-- BEGIN GENERATED tw_districts (scripts/gen-tw-districts.mts 產生，請勿手改；來源與排除項目見 scripts/data/tw-districts-source/SOURCE.md)
insert into public.tw_districts (city, district, postal_code) values
  ('臺北市', '中正區', '100'),
  ('臺北市', '大同區', '103'),
  ('臺北市', '中山區', '104'),
  ('臺北市', '松山區', '105'),
  ('臺北市', '大安區', '106'),
  ('臺北市', '萬華區', '108'),
  ('臺北市', '信義區', '110'),
  ('臺北市', '士林區', '111'),
  ('臺北市', '北投區', '112'),
  ('臺北市', '內湖區', '114'),
  ('臺北市', '南港區', '115'),
  ('臺北市', '文山區', '116'),
  ('基隆市', '仁愛區', '200'),
  ('基隆市', '信義區', '201'),
  ('基隆市', '中正區', '202'),
  ('基隆市', '中山區', '203'),
  ('基隆市', '安樂區', '204'),
  ('基隆市', '暖暖區', '205'),
  ('基隆市', '七堵區', '206'),
  ('新北市', '萬里區', '207'),
  ('新北市', '金山區', '208'),
  ('新北市', '板橋區', '220'),
  ('新北市', '汐止區', '221'),
  ('新北市', '深坑區', '222'),
  ('新北市', '石碇區', '223'),
  ('新北市', '瑞芳區', '224'),
  ('新北市', '平溪區', '226'),
  ('新北市', '雙溪區', '227'),
  ('新北市', '貢寮區', '228'),
  ('新北市', '新店區', '231'),
  ('新北市', '坪林區', '232'),
  ('新北市', '烏來區', '233'),
  ('新北市', '永和區', '234'),
  ('新北市', '中和區', '235'),
  ('新北市', '土城區', '236'),
  ('新北市', '三峽區', '237'),
  ('新北市', '樹林區', '238'),
  ('新北市', '鶯歌區', '239'),
  ('新北市', '三重區', '241'),
  ('新北市', '新莊區', '242'),
  ('新北市', '泰山區', '243'),
  ('新北市', '林口區', '244'),
  ('新北市', '蘆洲區', '247'),
  ('新北市', '五股區', '248'),
  ('新北市', '八里區', '249'),
  ('新北市', '淡水區', '251'),
  ('新北市', '三芝區', '252'),
  ('新北市', '石門區', '253'),
  ('宜蘭縣', '宜蘭市', '260'),
  ('宜蘭縣', '頭城鎮', '261'),
  ('宜蘭縣', '礁溪鄉', '262'),
  ('宜蘭縣', '壯圍鄉', '263'),
  ('宜蘭縣', '員山鄉', '264'),
  ('宜蘭縣', '羅東鎮', '265'),
  ('宜蘭縣', '三星鄉', '266'),
  ('宜蘭縣', '大同鄉', '267'),
  ('宜蘭縣', '五結鄉', '268'),
  ('宜蘭縣', '冬山鄉', '269'),
  ('宜蘭縣', '蘇澳鎮', '270'),
  ('宜蘭縣', '南澳鄉', '272'),
  ('新竹市', '北區', '300'),
  ('新竹市', '東區', '300'),
  ('新竹市', '香山區', '300'),
  ('新竹縣', '竹北市', '302'),
  ('新竹縣', '湖口鄉', '303'),
  ('新竹縣', '新豐鄉', '304'),
  ('新竹縣', '新埔鎮', '305'),
  ('新竹縣', '關西鎮', '306'),
  ('新竹縣', '芎林鄉', '307'),
  ('新竹縣', '寶山鄉', '308'),
  ('新竹縣', '竹東鎮', '310'),
  ('新竹縣', '五峰鄉', '311'),
  ('新竹縣', '橫山鄉', '312'),
  ('新竹縣', '尖石鄉', '313'),
  ('新竹縣', '北埔鄉', '314'),
  ('新竹縣', '峨眉鄉', '315'),
  ('桃園市', '中壢區', '320'),
  ('桃園市', '平鎮區', '324'),
  ('桃園市', '龍潭區', '325'),
  ('桃園市', '楊梅區', '326'),
  ('桃園市', '新屋區', '327'),
  ('桃園市', '觀音區', '328'),
  ('桃園市', '桃園區', '330'),
  ('桃園市', '龜山區', '333'),
  ('桃園市', '八德區', '334'),
  ('桃園市', '大溪區', '335'),
  ('桃園市', '復興區', '336'),
  ('桃園市', '大園區', '337'),
  ('桃園市', '蘆竹區', '338'),
  ('苗栗縣', '竹南鎮', '350'),
  ('苗栗縣', '頭份市', '351'),
  ('苗栗縣', '三灣鄉', '352'),
  ('苗栗縣', '南庄鄉', '353'),
  ('苗栗縣', '獅潭鄉', '354'),
  ('苗栗縣', '後龍鎮', '356'),
  ('苗栗縣', '通霄鎮', '357'),
  ('苗栗縣', '苑裡鎮', '358'),
  ('苗栗縣', '苗栗市', '360'),
  ('苗栗縣', '造橋鄉', '361'),
  ('苗栗縣', '頭屋鄉', '362'),
  ('苗栗縣', '公館鄉', '363'),
  ('苗栗縣', '大湖鄉', '364'),
  ('苗栗縣', '泰安鄉', '365'),
  ('苗栗縣', '銅鑼鄉', '366'),
  ('苗栗縣', '三義鄉', '367'),
  ('苗栗縣', '西湖鄉', '368'),
  ('苗栗縣', '卓蘭鎮', '369'),
  ('臺中市', '中區', '400'),
  ('臺中市', '東區', '401'),
  ('臺中市', '南區', '402'),
  ('臺中市', '西區', '403'),
  ('臺中市', '北區', '404'),
  ('臺中市', '北屯區', '406'),
  ('臺中市', '西屯區', '407'),
  ('臺中市', '南屯區', '408'),
  ('臺中市', '太平區', '411'),
  ('臺中市', '大里區', '412'),
  ('臺中市', '霧峰區', '413'),
  ('臺中市', '烏日區', '414'),
  ('臺中市', '豐原區', '420'),
  ('臺中市', '后里區', '421'),
  ('臺中市', '石岡區', '422'),
  ('臺中市', '東勢區', '423'),
  ('臺中市', '和平區', '424'),
  ('臺中市', '新社區', '426'),
  ('臺中市', '潭子區', '427'),
  ('臺中市', '大雅區', '428'),
  ('臺中市', '神岡區', '429'),
  ('臺中市', '大肚區', '432'),
  ('臺中市', '沙鹿區', '433'),
  ('臺中市', '龍井區', '434'),
  ('臺中市', '梧棲區', '435'),
  ('臺中市', '清水區', '436'),
  ('臺中市', '大甲區', '437'),
  ('臺中市', '外埔區', '438'),
  ('臺中市', '大安區', '439'),
  ('彰化縣', '彰化市', '500'),
  ('彰化縣', '芬園鄉', '502'),
  ('彰化縣', '花壇鄉', '503'),
  ('彰化縣', '秀水鄉', '504'),
  ('彰化縣', '鹿港鎮', '505'),
  ('彰化縣', '福興鄉', '506'),
  ('彰化縣', '線西鄉', '507'),
  ('彰化縣', '和美鎮', '508'),
  ('彰化縣', '伸港鄉', '509'),
  ('彰化縣', '員林市', '510'),
  ('彰化縣', '社頭鄉', '511'),
  ('彰化縣', '永靖鄉', '512'),
  ('彰化縣', '埔心鄉', '513'),
  ('彰化縣', '溪湖鎮', '514'),
  ('彰化縣', '大村鄉', '515'),
  ('彰化縣', '埔鹽鄉', '516'),
  ('彰化縣', '田中鎮', '520'),
  ('彰化縣', '北斗鎮', '521'),
  ('彰化縣', '田尾鄉', '522'),
  ('彰化縣', '埤頭鄉', '523'),
  ('彰化縣', '溪州鄉', '524'),
  ('彰化縣', '竹塘鄉', '525'),
  ('彰化縣', '二林鎮', '526'),
  ('彰化縣', '大城鄉', '527'),
  ('彰化縣', '芳苑鄉', '528'),
  ('彰化縣', '二水鄉', '530'),
  ('南投縣', '南投市', '540'),
  ('南投縣', '中寮鄉', '541'),
  ('南投縣', '草屯鎮', '542'),
  ('南投縣', '國姓鄉', '544'),
  ('南投縣', '埔里鎮', '545'),
  ('南投縣', '仁愛鄉', '546'),
  ('南投縣', '名間鄉', '551'),
  ('南投縣', '集集鎮', '552'),
  ('南投縣', '水里鄉', '553'),
  ('南投縣', '魚池鄉', '555'),
  ('南投縣', '信義鄉', '556'),
  ('南投縣', '竹山鎮', '557'),
  ('南投縣', '鹿谷鄉', '558'),
  ('嘉義市', '西區', '600'),
  ('嘉義市', '東區', '600'),
  ('嘉義縣', '番路鄉', '602'),
  ('嘉義縣', '梅山鄉', '603'),
  ('嘉義縣', '竹崎鄉', '604'),
  ('嘉義縣', '阿里山鄉', '605'),
  ('嘉義縣', '中埔鄉', '606'),
  ('嘉義縣', '大埔鄉', '607'),
  ('嘉義縣', '水上鄉', '608'),
  ('嘉義縣', '鹿草鄉', '611'),
  ('嘉義縣', '太保市', '612'),
  ('嘉義縣', '朴子市', '613'),
  ('嘉義縣', '東石鄉', '614'),
  ('嘉義縣', '六腳鄉', '615'),
  ('嘉義縣', '新港鄉', '616'),
  ('嘉義縣', '民雄鄉', '621'),
  ('嘉義縣', '大林鎮', '622'),
  ('嘉義縣', '溪口鄉', '623'),
  ('嘉義縣', '義竹鄉', '624'),
  ('嘉義縣', '布袋鎮', '625'),
  ('雲林縣', '斗南鎮', '630'),
  ('雲林縣', '大埤鄉', '631'),
  ('雲林縣', '虎尾鎮', '632'),
  ('雲林縣', '土庫鎮', '633'),
  ('雲林縣', '褒忠鄉', '634'),
  ('雲林縣', '東勢鄉', '635'),
  ('雲林縣', '臺西鄉', '636'),
  ('雲林縣', '崙背鄉', '637'),
  ('雲林縣', '麥寮鄉', '638'),
  ('雲林縣', '斗六市', '640'),
  ('雲林縣', '林內鄉', '643'),
  ('雲林縣', '古坑鄉', '646'),
  ('雲林縣', '莿桐鄉', '647'),
  ('雲林縣', '西螺鎮', '648'),
  ('雲林縣', '二崙鄉', '649'),
  ('雲林縣', '北港鎮', '651'),
  ('雲林縣', '水林鄉', '652'),
  ('雲林縣', '口湖鄉', '653'),
  ('雲林縣', '四湖鄉', '654'),
  ('雲林縣', '元長鄉', '655'),
  ('臺南市', '中西區', '700'),
  ('臺南市', '東區', '701'),
  ('臺南市', '南區', '702'),
  ('臺南市', '北區', '704'),
  ('臺南市', '安平區', '708'),
  ('臺南市', '安南區', '709'),
  ('臺南市', '永康區', '710'),
  ('臺南市', '歸仁區', '711'),
  ('臺南市', '新化區', '712'),
  ('臺南市', '左鎮區', '713'),
  ('臺南市', '玉井區', '714'),
  ('臺南市', '楠西區', '715'),
  ('臺南市', '南化區', '716'),
  ('臺南市', '仁德區', '717'),
  ('臺南市', '關廟區', '718'),
  ('臺南市', '龍崎區', '719'),
  ('臺南市', '官田區', '720'),
  ('臺南市', '麻豆區', '721'),
  ('臺南市', '佳里區', '722'),
  ('臺南市', '西港區', '723'),
  ('臺南市', '七股區', '724'),
  ('臺南市', '將軍區', '725'),
  ('臺南市', '學甲區', '726'),
  ('臺南市', '北門區', '727'),
  ('臺南市', '新營區', '730'),
  ('臺南市', '後壁區', '731'),
  ('臺南市', '白河區', '732'),
  ('臺南市', '東山區', '733'),
  ('臺南市', '六甲區', '734'),
  ('臺南市', '下營區', '735'),
  ('臺南市', '柳營區', '736'),
  ('臺南市', '鹽水區', '737'),
  ('臺南市', '善化區', '741'),
  ('臺南市', '大內區', '742'),
  ('臺南市', '山上區', '743'),
  ('臺南市', '新市區', '744'),
  ('臺南市', '安定區', '745'),
  ('高雄市', '新興區', '800'),
  ('高雄市', '前金區', '801'),
  ('高雄市', '苓雅區', '802'),
  ('高雄市', '鹽埕區', '803'),
  ('高雄市', '鼓山區', '804'),
  ('高雄市', '旗津區', '805'),
  ('高雄市', '前鎮區', '806'),
  ('高雄市', '三民區', '807'),
  ('高雄市', '楠梓區', '811'),
  ('高雄市', '小港區', '812'),
  ('高雄市', '左營區', '813'),
  ('高雄市', '仁武區', '814'),
  ('高雄市', '大社區', '815'),
  ('高雄市', '岡山區', '820'),
  ('高雄市', '路竹區', '821'),
  ('高雄市', '阿蓮區', '822'),
  ('高雄市', '田寮區', '823'),
  ('高雄市', '燕巢區', '824'),
  ('高雄市', '橋頭區', '825'),
  ('高雄市', '梓官區', '826'),
  ('高雄市', '彌陀區', '827'),
  ('高雄市', '永安區', '828'),
  ('高雄市', '湖內區', '829'),
  ('高雄市', '鳳山區', '830'),
  ('高雄市', '大寮區', '831'),
  ('高雄市', '林園區', '832'),
  ('高雄市', '鳥松區', '833'),
  ('高雄市', '大樹區', '840'),
  ('高雄市', '旗山區', '842'),
  ('高雄市', '美濃區', '843'),
  ('高雄市', '六龜區', '844'),
  ('高雄市', '內門區', '845'),
  ('高雄市', '杉林區', '846'),
  ('高雄市', '甲仙區', '847'),
  ('高雄市', '桃源區', '848'),
  ('高雄市', '那瑪夏區', '849'),
  ('高雄市', '茂林區', '851'),
  ('高雄市', '茄萣區', '852'),
  ('澎湖縣', '馬公市', '880'),
  ('澎湖縣', '西嶼鄉', '881'),
  ('澎湖縣', '望安鄉', '882'),
  ('澎湖縣', '七美鄉', '883'),
  ('澎湖縣', '白沙鄉', '884'),
  ('澎湖縣', '湖西鄉', '885'),
  ('金門縣', '金沙鎮', '890'),
  ('金門縣', '金湖鎮', '891'),
  ('金門縣', '金寧鄉', '892'),
  ('金門縣', '金城鎮', '893'),
  ('金門縣', '烈嶼鄉', '894'),
  ('金門縣', '烏坵鄉', '896'),
  ('連江縣', '南竿鄉', '209'),
  ('連江縣', '北竿鄉', '210'),
  ('連江縣', '莒光鄉', '211'),
  ('連江縣', '東引鄉', '212'),
  ('屏東縣', '屏東市', '900'),
  ('屏東縣', '三地門鄉', '901'),
  ('屏東縣', '霧臺鄉', '902'),
  ('屏東縣', '瑪家鄉', '903'),
  ('屏東縣', '九如鄉', '904'),
  ('屏東縣', '里港鄉', '905'),
  ('屏東縣', '高樹鄉', '906'),
  ('屏東縣', '鹽埔鄉', '907'),
  ('屏東縣', '長治鄉', '908'),
  ('屏東縣', '麟洛鄉', '909'),
  ('屏東縣', '竹田鄉', '911'),
  ('屏東縣', '內埔鄉', '912'),
  ('屏東縣', '萬丹鄉', '913'),
  ('屏東縣', '潮州鎮', '920'),
  ('屏東縣', '泰武鄉', '921'),
  ('屏東縣', '來義鄉', '922'),
  ('屏東縣', '萬巒鄉', '923'),
  ('屏東縣', '崁頂鄉', '924'),
  ('屏東縣', '新埤鄉', '925'),
  ('屏東縣', '南州鄉', '926'),
  ('屏東縣', '林邊鄉', '927'),
  ('屏東縣', '東港鎮', '928'),
  ('屏東縣', '琉球鄉', '929'),
  ('屏東縣', '佳冬鄉', '931'),
  ('屏東縣', '新園鄉', '932'),
  ('屏東縣', '枋寮鄉', '940'),
  ('屏東縣', '枋山鄉', '941'),
  ('屏東縣', '春日鄉', '942'),
  ('屏東縣', '獅子鄉', '943'),
  ('屏東縣', '車城鄉', '944'),
  ('屏東縣', '牡丹鄉', '945'),
  ('屏東縣', '恆春鎮', '946'),
  ('屏東縣', '滿州鄉', '947'),
  ('臺東縣', '臺東市', '950'),
  ('臺東縣', '綠島鄉', '951'),
  ('臺東縣', '蘭嶼鄉', '952'),
  ('臺東縣', '延平鄉', '953'),
  ('臺東縣', '卑南鄉', '954'),
  ('臺東縣', '鹿野鄉', '955'),
  ('臺東縣', '關山鎮', '956'),
  ('臺東縣', '海端鄉', '957'),
  ('臺東縣', '池上鄉', '958'),
  ('臺東縣', '東河鄉', '959'),
  ('臺東縣', '成功鎮', '961'),
  ('臺東縣', '長濱鄉', '962'),
  ('臺東縣', '太麻里鄉', '963'),
  ('臺東縣', '金峰鄉', '964'),
  ('臺東縣', '大武鄉', '965'),
  ('臺東縣', '達仁鄉', '966'),
  ('花蓮縣', '花蓮市', '970'),
  ('花蓮縣', '新城鄉', '971'),
  ('花蓮縣', '秀林鄉', '972'),
  ('花蓮縣', '吉安鄉', '973'),
  ('花蓮縣', '壽豐鄉', '974'),
  ('花蓮縣', '鳳林鎮', '975'),
  ('花蓮縣', '光復鄉', '976'),
  ('花蓮縣', '豐濱鄉', '977'),
  ('花蓮縣', '瑞穗鄉', '978'),
  ('花蓮縣', '萬榮鄉', '979'),
  ('花蓮縣', '玉里鎮', '981'),
  ('花蓮縣', '卓溪鄉', '982'),
  ('花蓮縣', '富里鄉', '983')
on conflict (city, district) do update set postal_code = excluded.postal_code;
-- END GENERATED tw_districts

-- ═══════════════════════════════════════════════════════════════════════
-- 2. profiles：個人檔案（目前只有暱稱；D13）
-- ═══════════════════════════════════════════════════════════════════════
-- 暱稱規則與評價暱稱相同（R-A4）：2～12 個字、只收中英文數字 _ -，可以沒有（null）。不公開顯示，只用來預填評價。
-- 用獨立的表而不是 user_metadata：使用者自己改得了 user_metadata，而且 Google／Apple 重新登入可能覆蓋同名欄位（K-16）；
-- 這裡寫入只能經過 set_my_nickname，R-A5 因此成立（本機實測見 t4-local-tests.md）。
create table if not exists public.profiles (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  nickname   text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_nickname_valid check (
    nickname is null or (
      char_length(nickname) between 2 and 12
      and nickname ~ '^[-_0-9A-Za-z㐀-䶿一-鿿豈-﫿\U00020000-\U0002fa1f\U00030000-\U000323af]+$'
    )
  )
);
alter table public.profiles enable row level security;
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles for select to authenticated
  using (user_id = auth.uid());
revoke all on public.profiles from public, anon, authenticated;
grant select on public.profiles to authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 3. addresses：地址簿（D14～D16）
-- ═══════════════════════════════════════════════════════════════════════
-- 電話只存 10 碼數字（R-A6）。「縣市＋區＋詳細地址」合計 ≤ 60 字（對齊綠界物流 ReceiverAddress）。
-- 字數一律用 char_length（code point），前端要用 [...s].length，不要用 s.length。
create table if not exists public.addresses (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  recipient   text not null,
  phone       text not null,
  city        text not null,
  district    text not null,
  postal_code text not null,
  detail      text not null,
  is_default  boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint addresses_recipient_valid check (char_length(recipient) between 1 and 20 and recipient !~ '[[:cntrl:]]'),
  constraint addresses_phone_valid     check (phone ~ '^09[0-9]{8}$'),
  constraint addresses_postal_valid    check (postal_code ~ '^[0-9]{3}$'),
  constraint addresses_detail_valid    check (char_length(detail) >= 2 and detail !~ '[[:cntrl:]]'),
  constraint addresses_length_valid    check (char_length(city) + char_length(district) + char_length(detail) <= 60)
);
create index if not exists addresses_user_idx on public.addresses (user_id, is_default desc, updated_at desc);
-- 每個帳號最多一筆預設（R-A7）：競爭條件下也成立（寫入還有 advisory lock 排隊，所以前端不會看到這個索引的英文錯誤）
create unique index if not exists addresses_one_default_per_user on public.addresses (user_id) where is_default;

alter table public.addresses enable row level security;
drop policy if exists addresses_select_own on public.addresses;
create policy addresses_select_own on public.addresses for select to authenticated
  using (user_id = auth.uid());
revoke all on public.addresses from public, anon, authenticated;
grant select on public.addresses to authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 4. 觸發器：updated_at、上限 10 筆、縣市／區／郵遞區號組合（任何寫入路徑都擋，包含 service role）
-- ═══════════════════════════════════════════════════════════════════════
create or replace function public._acct_touch()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end $$;
revoke all on function public._acct_touch() from public, anon, authenticated;

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles
  for each row execute function public._acct_touch();
drop trigger if exists addresses_touch on public.addresses;
create trigger addresses_touch before update on public.addresses
  for each row execute function public._acct_touch();

-- 為什麼用 trigger 而不是 (city,district,postal_code) 外鍵指向 tw_districts：
-- 行政區調整時清單會增刪，外鍵會擋住刪除、或逼我們改使用者已存的地址；規格 R-A18 第 4 點要求「已存的地址不自動改」。
-- trigger 只在新增或改到這三個欄位時核對。
create or replace function public._addr_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_n integer;
begin
  if tg_op = 'UPDATE' and new.user_id <> old.user_id then
    raise exception '不能把地址轉給別的帳號' using hint = 'ADDRESS_OWNER_IMMUTABLE';
  end if;
  if tg_op = 'INSERT' then
    -- 同一帳號的新增排隊，count 才不會被兩個同時進來的交易一起看到 9
    perform pg_advisory_xact_lock(hashtextextended('addr:' || new.user_id::text, 0));
    select count(*) into v_n from public.addresses where user_id = new.user_id;
    if v_n >= 10 then
      raise exception '地址最多只能存 10 筆' using hint = 'ADDRESS_LIMIT_REACHED';
    end if;
  end if;
  if tg_op = 'INSERT' or (new.city, new.district, new.postal_code) is distinct from (old.city, old.district, old.postal_code) then
    if not exists (select 1 from public.tw_districts d
                    where d.city = new.city and d.district = new.district and d.postal_code = new.postal_code) then
      raise exception '縣市、鄉鎮市區與郵遞區號不相符，請重新選擇' using hint = 'ADDRESS_REGION_INVALID';
    end if;
  end if;
  return new;
end $$;
revoke all on function public._addr_guard() from public, anon, authenticated;

drop trigger if exists addresses_guard on public.addresses;
create trigger addresses_guard before insert or update on public.addresses
  for each row execute function public._addr_guard();

-- ═══════════════════════════════════════════════════════════════════════
-- 5. RPC
-- ═══════════════════════════════════════════════════════════════════════

-- 設定（或清除）暱稱。p_nickname 空字串或 null＝清除（列保留、nickname 變 null）。第一次呼叫時才建 profiles 的列。
-- 驗證用 _rv_nickname（和評價送出同一份規則，NICKNAME_INVALID）。
create or replace function public.set_my_nickname(p_nickname text)
returns public.profiles language plpgsql security definer set search_path = public as $$
declare
  v_uid  uuid := public._acct_uid('請先登入');
  v_nick text := public._rv_nickname(p_nickname);
  v_row  public.profiles;
begin
  insert into public.profiles (user_id, nickname) values (v_uid, v_nick)
  on conflict (user_id) do update set nickname = excluded.nickname
  returning * into v_row;
  return v_row;
end $$;

-- 新增（p_id is null）或編輯（p_id 有值）一筆地址，回傳存好的那一列。
--   · 收件人 1～20 字；手機 09 開頭 10 碼（可帶連字號 0912-345-678，存成 0912345678）；
--     縣市＋區＋郵遞區號必須是清單裡的組合；詳細地址 ≥ 2 字；縣市＋區＋詳細地址 ≤ 60 字。前後空白去掉。
--   · 帳號的第一筆自動是預設。p_is_default = true 時，同一個交易裡取消舊預設。
--     目前的預設那筆傳 false：忽略，維持預設（預設不能用「取消勾選」拿掉，只能改設別筆為預設）。
--   · 新增時已有 10 筆 → ADDRESS_LIMIT_REACHED；編輯的 id 不存在或不是本人的 → ADDRESS_NOT_FOUND。
create or replace function public.save_address(
  p_id          uuid,
  p_recipient   text,
  p_phone       text,
  p_city        text,
  p_district    text,
  p_postal_code text,
  p_detail      text,
  p_is_default  boolean default false
) returns public.addresses language plpgsql security definer set search_path = public as $$
declare
  v_uid       uuid := public._acct_uid('請先登入');
  v_recipient text := public._rv_trim(coalesce(p_recipient, ''));
  v_phone     text := public._rv_trim(coalesce(p_phone, ''));
  v_city      text := public._rv_trim(coalesce(p_city, ''));
  v_district  text := public._rv_trim(coalesce(p_district, ''));
  v_zip       text := public._rv_trim(coalesce(p_postal_code, ''));
  v_detail    text := public._rv_trim(coalesce(p_detail, ''));
  v_row       public.addresses;
  v_n         integer;
  v_default   boolean;
begin
  if char_length(v_recipient) not between 1 and 20 or v_recipient ~ '[[:cntrl:]]' then
    perform public._rv_raise('ADDRESS_RECIPIENT_INVALID', '收件人需為 1 到 20 個字');
  end if;
  if v_phone !~ '^09[0-9]{2}-?[0-9]{3}-?[0-9]{3}$' then
    perform public._rv_raise('ADDRESS_PHONE_INVALID', '手機號碼需為 09 開頭的 10 碼數字');
  end if;
  v_phone := replace(v_phone, '-', '');
  if not exists (select 1 from public.tw_districts d
                  where d.city = v_city and d.district = v_district and d.postal_code = v_zip) then
    perform public._rv_raise('ADDRESS_REGION_INVALID', '縣市、鄉鎮市區與郵遞區號不相符，請重新選擇');
  end if;
  if char_length(v_detail) < 2 or v_detail ~ '[[:cntrl:]]' then
    perform public._rv_raise('ADDRESS_DETAIL_INVALID', '詳細地址至少需要 2 個字');
  end if;
  if char_length(v_city) + char_length(v_district) + char_length(v_detail) > 60 then
    perform public._rv_raise('ADDRESS_TOO_LONG', '縣市、鄉鎮市區與詳細地址合計最多 60 個字');
  end if;

  -- 同一帳號的所有寫入排隊（和 _addr_guard 用同一把鎖；advisory xact lock 同一交易可重複取得）
  perform pg_advisory_xact_lock(hashtextextended('addr:' || v_uid::text, 0));

  if p_id is null then
    select count(*) into v_n from public.addresses where user_id = v_uid;
    if v_n >= 10 then
      perform public._rv_raise('ADDRESS_LIMIT_REACHED', '地址最多只能存 10 筆');
    end if;
    v_default := coalesce(p_is_default, false) or v_n = 0;
    if v_default then
      update public.addresses set is_default = false where user_id = v_uid and is_default;
    end if;
    insert into public.addresses (user_id, recipient, phone, city, district, postal_code, detail, is_default)
    values (v_uid, v_recipient, v_phone, v_city, v_district, v_zip, v_detail, v_default)
    returning * into v_row;
  else
    select * into v_row from public.addresses where id = p_id and user_id = v_uid for update;
    if not found then
      perform public._rv_raise('ADDRESS_NOT_FOUND', '這筆地址已經被刪除');
    end if;
    v_default := coalesce(p_is_default, false) or v_row.is_default;
    if v_default and not v_row.is_default then
      update public.addresses set is_default = false where user_id = v_uid and is_default;
    end if;
    update public.addresses
       set recipient = v_recipient, phone = v_phone, city = v_city, district = v_district,
           postal_code = v_zip, detail = v_detail, is_default = v_default
     where id = p_id and user_id = v_uid
    returning * into v_row;
  end if;
  return v_row;
end $$;

-- 設為預設：同一個交易裡取消舊預設、設新預設。已經是預設就原樣回傳。
create or replace function public.set_default_address(p_id uuid)
returns public.addresses language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public._acct_uid('請先登入');
  v_row public.addresses;
begin
  perform pg_advisory_xact_lock(hashtextextended('addr:' || v_uid::text, 0));
  select * into v_row from public.addresses where id = p_id and user_id = v_uid for update;
  if not found then
    perform public._rv_raise('ADDRESS_NOT_FOUND', '這筆地址已經被刪除');
  end if;
  if not v_row.is_default then
    update public.addresses set is_default = false where user_id = v_uid and is_default;
    update public.addresses set is_default = true where id = p_id and user_id = v_uid returning * into v_row;
  end if;
  return v_row;
end $$;

-- 刪除：預設那筆不能刪，除非只剩它（R-A7）。
create or replace function public.delete_address(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public._acct_uid('請先登入');
  v_row public.addresses;
  v_n   integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('addr:' || v_uid::text, 0));
  select * into v_row from public.addresses where id = p_id and user_id = v_uid for update;
  if not found then
    perform public._rv_raise('ADDRESS_NOT_FOUND', '這筆地址已經被刪除');
  end if;
  select count(*) into v_n from public.addresses where user_id = v_uid;
  if v_row.is_default and v_n > 1 then
    perform public._rv_raise('ADDRESS_DEFAULT_PROTECTED', '預設地址不能刪除，請先把別筆設為預設');
  end if;
  delete from public.addresses where id = p_id and user_id = v_uid;
end $$;

revoke all on function public.set_my_nickname(text)                                       from public;
revoke all on function public.save_address(uuid, text, text, text, text, text, text, boolean) from public;
revoke all on function public.set_default_address(uuid)                                   from public;
revoke all on function public.delete_address(uuid)                                        from public;
grant execute on function public.set_my_nickname(text)                                       to anon, authenticated;
grant execute on function public.save_address(uuid, text, text, text, text, text, text, boolean) to anon, authenticated;
grant execute on function public.set_default_address(uuid)                                   to anon, authenticated;
grant execute on function public.delete_address(uuid)                                        to anon, authenticated;
