// 暱稱預填的共用測試向量（22 筆），前後端必須逐筆一致（D10＝B、D19＝A、R-14）。
// 來源：.work/buyer-auth/fixtures/nickname-prefill-vectors.json（小b 產出）。
// .work/ 不進版控，所以複製成這個 .ts 檔給單元測試用；規則改了要重新複製。
export interface PrefillVector { provider: string; full_name?: string | null; name?: string; expect: string; note: string }

export const PREFILL_VECTORS: PrefillVector[] = [
  {"provider": "google", "full_name": "李宗哲", "expect": "李宗哲", "note": "AC-33：全部合法，原樣帶入"},
  {"provider": "google", "full_name": "Harry Lee", "expect": "HarryLee", "note": "AC-33：中間空白去掉"},
  {"provider": "google", "full_name": "  王小明 😀 ", "expect": "王小明", "note": "AC-33：頭尾空白、emoji 去掉"},
  {"provider": "google", "full_name": "Zhe 李", "expect": "Zhe李", "note": "AC-33：中英混合，空白去掉"},
  {"provider": "google", "full_name": "A", "expect": "", "note": "AC-33：去完不足 2 字 → 留空"},
  {"provider": "google", "full_name": "やまだ", "expect": "", "note": "AC-33：日文假名不在允許字元內 → 全去掉 → 留空"},
  {"provider": "google", "full_name": "Jean-Luc_Picard2024", "expect": "Jean-Luc_Pic", "note": "AC-33：超過 12 字取前 12 字（連字號、底線是合法字元）"},
  {"provider": "google", "full_name": "𠮷野家", "expect": "𠮷野家", "note": "AC-33：擴充 B 區漢字，以 code point 計 3 字"},
  {"provider": "apple", "full_name": null, "expect": "", "note": "AC-33：Apple 帳號不帶入"},
  {"provider": "email", "full_name": null, "expect": "", "note": "AC-33：email 密碼帳號不帶入"},
  {"provider": "google", "full_name": "", "name": "Bob Smith", "expect": "BobSmith", "note": "R-14：full_name 是空字串或不存在時改用 name"},
  {"provider": "google", "name": "陳小美", "expect": "陳小美", "note": "R-14：只有 name"},
  {"provider": "google", "full_name": "😀😀😀", "expect": "", "note": "全是 emoji → 留空"},
  {"provider": "google", "full_name": "一二三四五六七八九十一二三四", "expect": "一二三四五六七八九十一二", "note": "14 個漢字取前 12"},
  {"provider": "google", "full_name": "𠮷𠮷𠮷𠮷𠮷𠮷𠮷𠮷𠮷𠮷𠮷𠮷𠮷", "expect": "𠮷𠮷𠮷𠮷𠮷𠮷𠮷𠮷𠮷𠮷𠮷𠮷", "note": "13 個擴充 B 區漢字：必須以 code point 截斷，不能以 UTF-16 單位截斷"},
  {"provider": "google", "full_name": "Ｈarry", "expect": "arry", "note": "全形英文字母不合法 → 去掉；剩 4 字"},
  {"provider": "google", "full_name": "O'Brien", "expect": "OBrien", "note": "撇號去掉"},
  {"provider": "google", "full_name": "x@y.com", "expect": "xycom", "note": "@ 與 . 去掉"},
  {"provider": "google", "full_name": "小　貓", "expect": "小貓", "note": "全形空白去掉"},
  {"provider": "google", "full_name": "①②③ ab", "expect": "ab", "note": "帶圈數字不合法，去掉後剩 ab（剛好 2 字）"},
  {"provider": "google", "full_name": "-", "expect": "", "note": "只剩 1 字 → 留空"},
  {"provider": "google", "full_name": "a-", "expect": "a-", "note": "連字號合法，2 字"},
];
