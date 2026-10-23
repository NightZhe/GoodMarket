import { describe, expect, it } from 'vitest';
import { createEcpayClient } from './ecpayClient.ts';
import { fakeEcpay, TEST_CFG, type Handler } from './ecpayTestKit.ts';
import { adminSecretOk, revokeAccountCards, type BeginResult, type RevokeStore } from './accountRevoke.ts';

// 假綠界：每個會員一份綁卡清單；刪除不存在的卡回 5100088（B-0 實測值）；清單空時查詢也回 5100088。
type Card = { bindCardId: string; card6: string; card4: string };
function ecpayWorld(members: Record<string, Card[]>, override: Handler = () => undefined as never) {
  const f = fakeEcpay((path, data) => {
    const o = override(path, data);
    if (o !== undefined) return o;
    if (path === '/Merchant/DeleteMemberBindCard') {
      for (const list of Object.values(members)) {
        const i = list.findIndex((c) => c.bindCardId === data.BindCardID);
        if (i >= 0) { list.splice(i, 1); return { RtnCode: 1, RtnMsg: 'Success' }; }
      }
      return { RtnCode: 5100088, RtnMsg: 'The BindCard does not exist.' };
    }
    if (path === '/Merchant/GetMemberBindCard') {
      const list = members[data.MerchantMemberID] ?? [];
      if (!list.length) return { BindCardList: null, RtnCode: 5100088, RtnMsg: 'The BindCard does not exist.' };
      return { RtnCode: 1, RtnMsg: 'Success', BindCardList: list.map((c) => ({ BindCardID: c.bindCardId, Card6No: c.card6, Card4No: c.card4, CardValidYY: '30', CardValidMM: '12' })) };
    }
    throw new Error('unexpected path ' + path);
  });
  return { ...f, client: createEcpayClient(TEST_CFG, f.fetchFn, () => 1_700_000_000_000) };
}

type Row = { id: string; userId: string; bindCardId: string; card6: string; card4: string; status: 'active' | 'revoking'; revokeFailures: number };
function memoryStore(rows: Row[], members: Record<string, string>, refuse?: Extract<BeginResult, { ok: false }>) {
  const st = { rows, writes: 0 };
  const store: RevokeStore = {
    async begin(userId) {
      if (refuse) return refuse;
      const mine = st.rows.filter((r) => r.userId === userId);
      const cards = mine.map((r) => ({ id: r.id, bindCardId: r.bindCardId, card6: r.card6, card4: r.card4, statusBefore: r.status, revokeFailures: r.revokeFailures }));
      for (const r of mine) if (r.status !== 'revoking') { r.status = 'revoking'; st.writes++; }
      return { ok: true, memberId: members[userId] ?? null, cards };
    },
    async finishDelete(id) { const i = st.rows.findIndex((r) => r.id === id && r.status === 'revoking'); if (i >= 0) { st.rows.splice(i, 1); st.writes++; } },
    async recordFailure(id) { const r = st.rows.find((x) => x.id === id && x.status === 'revoking'); if (r) { r.revokeFailures++; st.writes++; } },
    async countMethods(userId) { return st.rows.filter((r) => r.userId === userId).length; },
  };
  return { store, st };
}

const X = 'u-x', MX = 'mXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX1';
const card = (n: number): Card => ({ bindCardId: `BINDX${n}SECRET`, card6: '431195', card4: `000${n}` });
const row = (n: number, status: Row['status'] = 'active', userId = X): Row => ({ id: `pm-${n}`, userId, bindCardId: `BINDX${n}SECRET`, card6: '431195', card4: `000${n}`, status, revokeFailures: 0 });
const run = (store: RevokeStore, client: ReturnType<typeof ecpayWorld>['client'], userId = X) =>
  revokeAccountCards({ store, gateway: client, bindMerchantId: '3002607', now: () => Date.UTC(2026, 9, 20, 15, 0, 0) }, userId);

describe('revokeAccountCards：刪帳號前向綠界刪掉這個人的全部綁卡（spec-account-delete-cards）', () => {
  it('AC-1：2 張有效＋1 張撤銷中，綠界都刪成功 → allRevoked、3 張都是 deleted、本站與綠界都剩 0 張', async () => {
    const world = { [MX]: [card(1), card(2), card(3)] };
    const e = ecpayWorld(world);
    const m = memoryStore([row(1), row(2), row(3, 'revoking')], { [X]: MX });
    const r = await run(m.store, e.client);
    expect(r).toMatchObject({ userId: X, hasMember: true, allRevoked: true, queryOk: true, ecpayRemaining: 0, siteRemaining: 0, orphans: [] });
    expect(r.cards.map((c) => [c.id, c.card4, c.result])).toEqual([['pm-1', '0001', 'deleted'], ['pm-2', '0002', 'deleted'], ['pm-3', '0003', 'deleted']]);
    expect(world[MX]).toEqual([]);
    expect(m.st.rows).toEqual([]);
  });

  it('AC-2：其中 1 張綠界拒刪、反查清單裡還在 → failed（附綠界代碼、訊息、末四碼、本站 id），其他照刪；沒刪掉的那張留在 revoking 並記一次失敗', async () => {
    const world = { [MX]: [card(1), card(2)] };
    const e = ecpayWorld(world, (path, data) => path === '/Merchant/DeleteMemberBindCard' && data.BindCardID === 'BINDX2SECRET' ? { RtnCode: 5100099, RtnMsg: 'Some failure' } : undefined as never);
    const m = memoryStore([row(1), row(2)], { [X]: MX });
    const r = await run(m.store, e.client);
    expect(r).toMatchObject({ allRevoked: false, queryOk: true, ecpayRemaining: 1, siteRemaining: 1 });
    expect(r.cards).toEqual([
      { id: 'pm-1', card6: '431195', card4: '0001', statusBefore: 'active', result: 'deleted', rtnCode: 1, rtnMsg: null },
      { id: 'pm-2', card6: '431195', card4: '0002', statusBefore: 'active', result: 'failed', rtnCode: 5100099, rtnMsg: 'Some failure' },
    ]);
    expect(m.st.rows).toEqual([{ ...row(2), status: 'revoking', revokeFailures: 1 }]);
  });

  it('AC-3：綠界說刪除失敗（卡不存在），但反查清單裡已經沒有這張 → already_gone，算成功', async () => {
    const world = { [MX]: [card(1)] };
    const e = ecpayWorld(world);
    const m = memoryStore([row(1), row(9)], { [X]: MX });   // pm-9 綠界上已經沒有
    const r = await run(m.store, e.client);
    expect(r).toMatchObject({ allRevoked: true, ecpayRemaining: 0, siteRemaining: 0 });
    expect(r.cards.map((c) => [c.id, c.result, c.rtnCode])).toEqual([['pm-1', 'deleted', 1], ['pm-9', 'already_gone', 5100088]]);
  });

  it('AC-3：反查本身失敗 → queryOk=false、allRevoked=false，沒刪成功的卡記為 failed，回報綠界的查詢錯誤', async () => {
    const e = ecpayWorld({ [MX]: [] }, (path) => path === '/Merchant/GetMemberBindCard' ? { RtnCode: 5100011, RtnMsg: 'The parameter [MerchantMemberID] Incorrect format' } : undefined as never);
    const m = memoryStore([row(9)], { [X]: MX });
    const r = await run(m.store, e.client);
    expect(r).toMatchObject({ allRevoked: false, queryOk: false, ecpayRemaining: null, siteRemaining: 1,
      queryError: { rtnCode: 5100011, rtnMsg: 'The parameter [MerchantMemberID] Incorrect format' } });
    expect(r.cards.map((c) => [c.id, c.result, c.rtnCode, c.rtnMsg])).toEqual([['pm-9', 'failed', 5100088, 'The BindCard does not exist.']]);
    expect(m.st.rows[0]).toMatchObject({ status: 'revoking', revokeFailures: 1 });
  });

  it('E-6：綠界逾時 → failed，rtnMsg=timeout；卡留在 revoking', async () => {
    const world = { [MX]: [card(1)] };
    const e = ecpayWorld(world, (path) => path === '/Merchant/DeleteMemberBindCard' ? 'timeout' : undefined as never);
    const m = memoryStore([row(1)], { [X]: MX });
    const r = await run(m.store, e.client);
    expect(r).toMatchObject({ allRevoked: false, ecpayRemaining: 1 });
    expect(r.cards[0]).toMatchObject({ result: 'failed', rtnCode: null, rtnMsg: 'timeout' });
    expect(m.st.rows[0]).toMatchObject({ status: 'revoking', revokeFailures: 1 });
  });

  it('AC-4：綠界清單裡有本站不知道的卡（孤兒卡）→ 一起刪掉，列在 orphans（前 6／後 4／sha256 前 8 碼），最後綠界剩 0 張', async () => {
    const orphan = { bindCardId: 'ORPHAN-BIND-ID', card6: '431195', card4: '1111' };
    const world = { [MX]: [card(1), orphan] };
    const e = ecpayWorld(world);
    const m = memoryStore([row(1)], { [X]: MX });
    const r = await run(m.store, e.client);
    // sha256('ORPHAN-BIND-ID') 前 8 碼，用 `printf ORPHAN-BIND-ID | shasum -a 256` 算出
    expect(r.orphans).toEqual([{ card6: '431195', card4: '1111', ref: '5fe0ed7e', result: 'deleted', rtnCode: 1, rtnMsg: null }]);
    expect(r).toMatchObject({ allRevoked: true, ecpayRemaining: 0, siteRemaining: 0 });
    expect(world[MX]).toEqual([]);
  });

  it('AC-4：孤兒卡刪不掉 → allRevoked=false，ecpayRemaining=1，orphans 帶綠界回的代碼', async () => {
    const orphan = { bindCardId: 'ORPHAN-BIND-ID', card6: '431195', card4: '1111' };
    const e = ecpayWorld({ [MX]: [orphan] }, (path, data) => path === '/Merchant/DeleteMemberBindCard' && data.BindCardID === 'ORPHAN-BIND-ID' ? { RtnCode: 5100099, RtnMsg: 'nope' } : undefined as never);
    const m = memoryStore([], { [X]: MX });
    const r = await run(m.store, e.client);
    expect(r).toMatchObject({ allRevoked: false, queryOk: true, ecpayRemaining: 1 });
    expect(r.orphans).toEqual([{ card6: '431195', card4: '1111', ref: '5fe0ed7e', result: 'failed', rtnCode: 5100099, rtnMsg: 'nope' }]);
  });

  it('AC-8／R-8：回應裡找不到任何 BindCardID 與會員代號，連綠界訊息裡夾帶的也遮掉', async () => {
    const orphan = { bindCardId: 'ORPHAN-BIND-ID', card6: '431195', card4: '1111' };
    const e = ecpayWorld({ [MX]: [card(1), card(2), orphan] }, (path, data) =>
      path === '/Merchant/DeleteMemberBindCard' && data.BindCardID === 'BINDX2SECRET' ? { RtnCode: 5100099, RtnMsg: `card BINDX2SECRET of ${MX} locked` } : undefined as never);
    const m = memoryStore([row(1), row(2)], { [X]: MX });
    const text = JSON.stringify(await run(m.store, e.client));
    for (const secret of ['BINDX1SECRET', 'BINDX2SECRET', 'ORPHAN-BIND-ID', MX]) expect(text).not.toContain(secret);
    expect(text).toContain('card [redacted] of [redacted] locked');
  });

  it('AC-5／R-6：同一個請求送兩次 → 第二次 allRevoked=true，沒有任何寫入、沒有新的失敗', async () => {
    const world = { [MX]: [card(1), card(2)] };
    const e = ecpayWorld(world);
    const m = memoryStore([row(1), row(2, 'revoking')], { [X]: MX });
    expect((await run(m.store, e.client)).allRevoked).toBe(true);
    const writes = m.st.writes;
    const r2 = await run(m.store, e.client);
    expect(r2).toMatchObject({ allRevoked: true, queryOk: true, ecpayRemaining: 0, siteRemaining: 0, cards: [], orphans: [] });
    expect(m.st.writes).toBe(writes);
  });

  it('E-7：有會員列、本站 0 張卡 → 仍然反查並清孤兒卡', async () => {
    const world = { [MX]: [{ bindCardId: 'HALF-BOUND', card6: '431195', card4: '2222' }] };
    const e = ecpayWorld(world);
    const r = await run(memoryStore([], { [X]: MX }).store, e.client);
    expect(r).toMatchObject({ hasMember: true, allRevoked: true, ecpayRemaining: 0, cards: [] });
    expect(r.orphans.map((o) => o.result)).toEqual(['deleted']);
  });

  it('E-8：沒有會員列、也沒有卡 → 不呼叫綠界，直接完成（這個帳號從來沒把會員代號送到綠界）', async () => {
    const e = ecpayWorld({});
    const r = await run(memoryStore([], {}).store, e.client);
    expect(r).toMatchObject({ hasMember: false, allRevoked: true, queryOk: true, ecpayRemaining: 0, siteRemaining: 0 });
    expect(e.calls).toHaveLength(0);
  });

  it('異常：有卡卻沒有會員列 → 照樣刪卡，但無法反查 → queryOk=false、allRevoked=false', async () => {
    const e = ecpayWorld({ [MX]: [card(1)] });
    const r = await run(memoryStore([row(1)], {}).store, e.client);
    expect(r).toMatchObject({ hasMember: false, allRevoked: false, queryOk: false, queryError: { rtnCode: null, rtnMsg: 'no payment member' } });
  });

  it('AC-6：資料庫拒絕（付款或綁卡進行中）→ 丟 RevokeRefused（代碼＋可重試時間），沒有呼叫綠界', async () => {
    const e = ecpayWorld({ [MX]: [card(1)] });
    const m = memoryStore([row(1)], { [X]: MX }, { ok: false, code: 'PAYMENT_IN_PROGRESS', message: '有付款正在進行', retryAfter: '2026-10-20T15:30:00Z' });
    await expect(run(m.store, e.client)).rejects.toMatchObject({ code: 'PAYMENT_IN_PROGRESS', retryAfter: '2026-10-20T15:30:00Z' });
    expect(e.calls).toHaveLength(0);
    expect(m.st.rows[0].status).toBe('active');
  });

  it('AC-9：對照組帳號 Y 的卡與綠界清單都不受影響', async () => {
    const MY = 'mYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY1';
    const world = { [MX]: [card(1)], [MY]: [{ bindCardId: 'BINDY1', card6: '431195', card4: '2222' }] };
    const e = ecpayWorld(world);
    const m = memoryStore([row(1), { ...row(5, 'active', 'u-y'), bindCardId: 'BINDY1' }], { [X]: MX, 'u-y': MY });
    expect((await run(m.store, e.client)).allRevoked).toBe(true);
    expect(world[MY]).toHaveLength(1);
    expect(m.st.rows.map((r) => [r.userId, r.status])).toEqual([['u-y', 'active']]);
    expect(e.calls.filter((c) => c.data.MerchantMemberID).every((c) => c.data.MerchantMemberID === MX)).toBe(true);
  });
});

describe('checkedAt：刪卡步驟的時間基準（刪除 SQL 用它擋「刪卡之後才開始的綁卡」）', () => {
  it('取開始刪卡（標 revoking 之前）的時間，不是請求結束的時間：請求執行中才開始的綁卡也要被擋（小q 驗收 §3-1）', async () => {
    let clock = Date.UTC(2026, 9, 20, 15, 0, 0);
    const m = memoryStore([row(1)], { [X]: MX });
    const begin = m.store.begin.bind(m.store);
    m.store.begin = async (u) => { const r = await begin(u); clock += 60_000; return r; };   // 刪卡過程花了 1 分鐘
    const e = ecpayWorld({ [MX]: [card(1)] });
    const r = await revokeAccountCards({ store: m.store, gateway: e.client, bindMerchantId: '3002607', now: () => clock }, X);
    expect(r.checkedAt).toBe('2026-10-20T15:00:00.000Z');
  });
});

describe('adminSecretOk：管理函式的密碼（D34＝B：跟排程密碼分開）', () => {
  const ADMIN = 'a'.repeat(64), CRON = 'c'.repeat(64);
  it('正確的管理密碼 → 放行', () => expect(adminSecretOk(ADMIN, { adminSecret: ADMIN, cronSecret: CRON })).toBe(true));
  it('AC-7：沒帶、帶錯、帶排程密碼 → 拒絕', () => {
    expect(adminSecretOk('', { adminSecret: ADMIN, cronSecret: CRON })).toBe(false);
    expect(adminSecretOk('a'.repeat(63) + 'b', { adminSecret: ADMIN, cronSecret: CRON })).toBe(false);
    expect(adminSecretOk(CRON, { adminSecret: ADMIN, cronSecret: CRON })).toBe(false);
  });
  it('伺服器沒設管理密碼、密碼太短（< 32 字）、或跟排程密碼相同 → 一律拒絕（設定錯誤不能變成放行）', () => {
    expect(adminSecretOk('', { adminSecret: undefined, cronSecret: CRON })).toBe(false);
    expect(adminSecretOk('short', { adminSecret: 'short', cronSecret: CRON })).toBe(false);
    expect(adminSecretOk(CRON, { adminSecret: CRON, cronSecret: CRON })).toBe(false);
  });
});
