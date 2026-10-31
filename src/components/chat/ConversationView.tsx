import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ActionSheet, { type SheetAction } from './ActionSheet';
import ConversationScreen, { type ScreenHandlers, type ScreenModel } from './ConversationScreen';
import NicknamePromptSheet from './NicknamePromptSheet';
import LeaveDialog from '../import/LeaveDialog';
import PhotoLightbox from '../reviews/PhotoLightbox';
import { useToast } from '../Toast';
import { useAuth } from '../../store/AuthContext';
import { useOnline } from '../../lib/useOnline';
import { useConversation } from '../../lib/chat/useConversation';
import { useSignedUrls } from '../../lib/chat/useSignedUrls';
import { browserStore, dismissRules, rulesDismissed, rulesVisible } from '../../lib/chat/rules';
import {
  clearNicknamePromptPending, dismissNicknamePrompt, markNicknamePromptPending, nicknamePromptDismissed, sessionStore, shouldPromptNickname, takeNicknamePromptPending,
} from '../../lib/chat/nicknamePrompt';
import { fetchNickname } from '../../lib/account/profile';
import type { OpenTarget } from '../../lib/chat/outbox';
import type { ChatCard, ChatSide } from '../../lib/chat/types';
import type { DisplayMessage } from '../../lib/chat/outbox';

interface Props {
  side: ChatSide;
  /** 換對話請用 key 讓整個元件重來 */
  target: OpenTarget;
  backTo?: string;
  backLabel?: string;
  listTo: string;
  homeTo: string;
  ordersTo: string;
  fallbackName?: string;
  cardTo: (card: ChatCard) => string;
  /** 點卡片時目標還在不在（買家看自己的訂單與商品資料、賣家看店內資料） */
  cardGone: (card: ChatCard) => boolean;
  /** 隱藏成功之後（買家：回到列表）。賣家沒有隱藏，不傳 */
  onHidden?: () => void;
  /** 第一則訊息建立了對話之後：呼叫端把網址從「新對話」換成這條對話（replace） */
  onCreated?: (conversationId: string) => void;
  desktopHint?: boolean;
  className?: string;
}

type Dialog = null | 'menu' | 'confirm-block';

/**
 * 一條對話的完整畫面（買家與賣家共用）：資料與動作來自 useConversation，畫面是 ConversationScreen。
 * 這裡負責把兩者接起來，加上選單、封鎖確認、全螢幕看圖、規則提示的本機記憶與各種 toast。
 */
export default function ConversationView(p: Props) {
  const [nickPrompt, setNickPrompt] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  /** 查一次顯示名稱；沒有就彈面板。查不到（離線、逾時）就不彈，旗標也清掉：邀請是盡力而為，不讓它在之後別的對話突然冒出來 */
  const checkNickname = useCallback(async () => {
    let nickname: string | null;
    try {
      nickname = await fetchNickname();
    } catch {
      if (mounted.current) clearNicknamePromptPending(sessionStore());
      return;
    }
    if (!mounted.current) return;
    clearNicknamePromptPending(sessionStore());
    if (shouldPromptNickname({ side: p.side, dismissed: nicknamePromptDismissed(browserStore()), nickname })) setNickPrompt(true);
  }, [p.side]);
  // 買家送出第一則成功後（D11）：沒略過過才去查顯示名稱。先記「待邀請」再查——第一則若同時建立了對話，
  // onCreated 會把網址換成 /chat/:id，這個元件會被卸載重掛，查詢回來時已經沒人收；重掛後的元件在下面的 effect 接手
  const onFirstSent = useCallback(() => {
    if (!shouldPromptNickname({ side: p.side, dismissed: nicknamePromptDismissed(browserStore()), nickname: undefined })) return;
    markNicknamePromptPending(sessionStore(), Date.now());
    void checkNickname();
  }, [p.side, checkNickname]);
  useEffect(() => {
    if (p.side !== 'buyer' || !takeNicknamePromptPending(sessionStore(), Date.now())) return;
    if (nicknamePromptDismissed(browserStore())) return;
    void checkNickname();
  }, [p.side, checkNickname]);
  const convo = useConversation(p.side, p.target, p.onCreated, onFirstSent);
  const online = useOnline();
  const toast = useToast();
  const { openLogin } = useAuth();

  const remotePaths = useMemo(() => convo.messages.filter(m => !m.photosAreLocal).flatMap(m => m.photos), [convo.messages]);
  const signed = useSignedUrls(remotePaths);

  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);
  const [unblockBusy, setUnblockBusy] = useState(false);
  const [focusToken, setFocusToken] = useState(0);
  const [rulesGone, setRulesGone] = useState(() => rulesDismissed(browserStore()));
  const [viewer, setViewer] = useState<{ paths: string[]; local: boolean; index: number; trigger: HTMLElement } | null>(null);

  const closeDialog = useCallback(() => setDialog(null), []);

  // 規則提示顯示到使用者按關閉（§8.2）；不依輸入框焦點收起，否則點「重送」時失焦會讓版面下推而點空（B1）
  const rulesShown = rulesVisible(rulesGone);

  const unblock = async () => {
    setUnblockBusy(true);
    const ok = await convo.unblock();
    setUnblockBusy(false);
    if (ok) setFocusToken(n => n + 1);
    else toast('解除封鎖失敗，請稍後再試', 'error');
  };

  const confirmBlock = async () => {
    setBusy(true);
    const ok = await convo.block();
    setBusy(false);
    if (ok) setDialog(null);
    else toast('封鎖失敗，請稍後再試', 'error');
  };

  const hide = async () => {
    setDialog(null);
    if (await convo.hide()) {
      toast('已隱藏對話', 'info');
      p.onHidden?.();
    } else {
      toast('隱藏失敗，請稍後再試', 'error');
    }
  };

  const m: ScreenModel = {
    side: p.side, phase: convo.phase, online, peer: convo.peer, fallbackName: p.fallbackName,
    blockedByMe: convo.blockedByMe, peerDeleted: convo.peerDeleted, hasMenu: convo.convId !== null,
    messages: convo.messages, hasMore: convo.hasMore, loadingMore: convo.loadingMore, moreFailed: convo.moreFailed, messagesFailed: convo.messagesFailed,
    pendingCard: convo.pendingCard, cardRemovable: convo.cardRemovable, rulesVisible: rulesShown,
    urls: signed.urls, signFailed: signed.failed, incoming: convo.incoming, failure: convo.failure,
    unblockBusy, focusToken, backTo: p.backTo, backLabel: p.backLabel, listTo: p.listTo, homeTo: p.homeTo, ordersTo: p.ordersTo,
    desktopHint: p.desktopHint, className: p.className,
  };

  const h: ScreenHandlers = {
    onOpenMenu: () => setDialog('menu'),
    onUnblock: () => { void unblock(); },
    onDismissRules: () => { dismissRules(browserStore()); setRulesGone(true); },
    onSend: convo.send,
    onResend: convo.resend,
    onRemoveCard: convo.removePendingCard,
    onLoadMore: () => { void convo.loadMore(); },
    onRetryLoad: convo.retryLoad,
    onRetryMessages: () => { void convo.retryMessages(); },
    onLogin: () => openLogin({ trigger: { kind: 'goto' } }),
    cardTo: p.cardTo,
    cardGone: p.cardGone,
    onCardGone: card => toast(card.type === 'product' ? '商品已下架' : '找不到訂單', 'info'),
    onBrokenImage: signed.refresh,
    onOpenImage: (msg: DisplayMessage, index, trigger) => setViewer({ paths: msg.photos, local: msg.photosAreLocal, index, trigger }),
  };

  const actions: SheetAction[] = [
    convo.blockedByMe
      ? { key: 'unblock', label: '解除封鎖', tone: 'brand', onSelect: () => { setDialog(null); void unblock(); } }
      : { key: 'block', label: '封鎖', hint: '對方和你都無法在這個對話傳送訊息。', tone: 'danger', onSelect: () => setDialog('confirm-block') },
    ...(p.onHidden
      ? [{ key: 'hide', label: '隱藏對話', hint: '只會從你的列表移除，對方再傳訊息時會回來。', tone: 'brand' as const, onSelect: () => { void hide(); } }]
      : []),
  ];

  return (
    <ConversationScreen
      m={m}
      h={h}
      overlays={
        <>
          {dialog === 'menu' && <ActionSheet title="對話選項" actions={actions} onClose={closeDialog} />}
          {dialog === 'confirm-block' && (
            // 說明文字不透露「對方會看到什麼」（D22）
            <LeaveDialog
              title="封鎖此用戶？"
              description="封鎖後，你和對方都無法在這個對話傳送訊息。既有的訂單不受影響，隨時可以解除封鎖。"
              stayLabel="取消" leaveLabel="封鎖" busy={busy} busyLabel="封鎖中…"
              onStay={closeDialog} onLeave={() => { void confirmBlock(); }}
            />
          )}
          {nickPrompt && (
            <NicknamePromptSheet
              onSaved={() => { setNickPrompt(false); toast('已儲存顯示名稱', 'info'); }}
              onSkip={() => { dismissNicknamePrompt(browserStore()); setNickPrompt(false); }}
              onClose={() => setNickPrompt(false)}
            />
          )}
          {viewer && (
            <PhotoLightbox
              paths={viewer.paths} startIndex={viewer.index} returnFocusTo={viewer.trigger} noun="圖片"
              urlFor={path => (viewer.local ? path : signed.urls[path] ?? '')}
              onReload={signed.refresh}
              onClose={() => setViewer(null)}
            />
          )}
        </>
      }
    />
  );
}
