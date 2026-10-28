import { useState } from 'react';
import ActionSheet from '../../components/chat/ActionSheet';
import ChatListView from '../../components/chat/ChatListView';
import { useToast } from '../../components/Toast';
import { useAuth } from '../../store/AuthContext';
import { useChat } from '../../store/ChatContext';
import { chatHide } from '../../lib/chat/api';
import { conversationPath, peerView } from '../../lib/chat/nav';
import { useChatList } from '../../lib/chat/useChatList';
import type { ConversationRow } from '../../lib/chat/types';

/** 買家的聊聊列表 #/chat（標題「聊聊」由 BuyerLayout 的大標題畫）。長按一列→底部動作表→隱藏對話 */
export default function ChatList() {
  const list = useChatList('buyer');
  const { openLogin } = useAuth();
  const { refresh } = useChat();
  const toast = useToast();
  const [sheetRow, setSheetRow] = useState<ConversationRow | null>(null);

  const hide = async (row: ConversationRow) => {
    setSheetRow(null);
    try {
      await chatHide(row.conversation_id);
    } catch {
      toast('隱藏失敗，請稍後再試', 'error');
      return;
    }
    list.removeRow(row.conversation_id);
    toast('已隱藏對話', 'info');
    void refresh();
  };

  return (
    <div className="mx-auto flex min-h-[55dvh] max-w-6xl flex-col">
      <ChatListView
        m={{
          side: 'buyer', phase: list.phase, rows: list.rows, hasMore: list.hasMore, loadingMore: list.loadingMore,
          moreFailed: list.moreFailed, staleFailed: list.staleFailed, now: new Date(), rowTo: r => conversationPath(r.conversation_id),
        }}
        h={{ onRetry: list.retry, onLoadMore: () => { void list.loadMore(); }, onLogin: () => openLogin({ trigger: { kind: 'goto' } }), onLongPress: setSheetRow }}
      />
      {sheetRow && (
        <ActionSheet
          title={`與『${peerView(sheetRow.counterpart).name}』的對話`}
          subtitle="只會從你的列表移除，對方再傳訊息時會回來。"
          actions={[{ key: 'hide', label: '隱藏對話', tone: 'brand', onSelect: () => { void hide(sheetRow); } }]}
          onClose={() => setSheetRow(null)}
        />
      )}
    </div>
  );
}
