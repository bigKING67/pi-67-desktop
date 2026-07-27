import type { SessionMessageView } from "@pi67/domain";
import { CircleAlert, MessageSquareText } from "lucide-react";
import { useMemo } from "react";
import { Virtuoso, type Components } from "react-virtuoso";
import { useAppStore } from "../app/app-store.js";
import { useSessionProjectionStore } from "../session/session-projection-store.js";
import { selectSessionId } from "../session/session-projection-selectors.js";
import { requestComposerPrefill } from "../composer/composer-events.js";
import { loadOlderConversation } from "../conversation/conversation-controller.js";
import { useCommittedConversationProjection } from "../conversation/conversation-store.js";
import { useLiveTurnStore } from "../live-turn/live-turn-store.js";
import { MessageCard } from "./MessageCard.js";

export function Transcript() {
  const sessionId = useSessionProjectionStore(selectSessionId);
  const runtime = useAppStore((state) => state.runtime);
  const sessionTransitionPending = useAppStore((state) => state.sessionTransitionPending);
  const {
    messages,
    page,
    streaming,
    loadingOlder,
    firstItemIndex,
    error: conversationError
  } = useCommittedConversationProjection();
  const textChunks = useLiveTurnStore((state) => state.textChunks);
  const thinkingChunks = useLiveTurnStore((state) => state.thinkingChunks);
  const liveText = useMemo(() => textChunks.join(""), [textChunks]);
  const liveThinking = useMemo(() => thinkingChunks.join(""), [thinkingChunks]);
  const hasLiveTurn = Boolean(liveText || liveThinking);

  if (!sessionId || sessionTransitionPending) {
    if (runtime.phase === "failed") {
      return (
        <div className="transcript-error" role="alert">
          <CircleAlert size={22} />
          <strong>Pi session 创建失败</strong>
          <span>{runtime.detail}</span>
        </div>
      );
    }
    return <div className="transcript-loading"><span className="loading-line" />{runtime.detail}</div>;
  }

  if (messages.length === 0 && !hasLiveTurn) {
    return (
      <div className="transcript-empty">
        <div className="empty-icon"><MessageSquareText size={22} /></div>
        <h2>从一个具体任务开始</h2>
        <p>描述目标、相关文件和验收标准。Pi 会使用当前工作区、模型和已加载资源。</p>
        <div className="starter-prompts">
          {STARTER_PROMPTS.map((prompt) => (
            <button key={prompt} type="button" onClick={() => requestComposerPrefill(prompt)}>{prompt}</button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div
      className="transcript-region"
      data-has-live-turn={hasLiveTurn}
      data-message-count={messages.length}
      data-session-id={sessionId}
    >
      <Virtuoso
        key={sessionId}
        components={TRANSCRIPT_COMPONENTS}
        context={{
          hasLiveTurn,
          liveText,
          liveThinking,
          hasOlder: page.hasOlder,
          loadingOlder,
          conversationError,
          loadOlderMessages: loadOlderConversation
        }}
        data={messages}
        computeItemKey={(_index, message) => message.id}
        firstItemIndex={firstItemIndex}
        followOutput={streaming ? "auto" : false}
        increaseViewportBy={{ top: 500, bottom: 800 }}
        initialTopMostItemIndex={Math.max(0, messages.length - 1)}
        itemContent={(_index, message) => <MessageCard message={message} />}
        startReached={() => void loadOlderConversation()}
      />
    </div>
  );
}

const STARTER_PROMPTS = [
  "解释这个项目的运行入口",
  "检查当前 Git 改动并找出风险",
  "实现一个有测试覆盖的小功能"
] as const;

interface TranscriptContext {
  hasLiveTurn: boolean;
  liveText: string;
  liveThinking: string;
  hasOlder: boolean;
  loadingOlder: boolean;
  conversationError: string | undefined;
  loadOlderMessages: () => Promise<void>;
}

const TRANSCRIPT_COMPONENTS: Components<SessionMessageView, TranscriptContext> = {
  Header: OlderMessagesHeader,
  Footer: LiveTurnFooter
};

function OlderMessagesHeader({ context }: { context: TranscriptContext }) {
  if (!context.hasOlder && !context.loadingOlder && !context.conversationError) return null;
  return (
    <div className="transcript-pagination" role="status">
      <button
        className="small-button"
        disabled={context.loadingOlder}
        onClick={() => void context.loadOlderMessages()}
        type="button"
      >
        {context.loadingOlder ? "正在加载更早消息" : "加载更早消息"}
      </button>
      {context.conversationError ? <span role="alert">{context.conversationError}</span> : null}
    </div>
  );
}

function LiveTurnFooter({ context }: { context: TranscriptContext }) {
  if (!context.hasLiveTurn) return null;
  return <MessageCard message={liveMessage(context.liveText, context.liveThinking)} streaming />;
}

function liveMessage(text: string, thinking: string): SessionMessageView {
  return {
    id: "live-assistant-message",
    role: "assistant",
    parts: [
      ...(thinking ? [{ type: "thinking" as const, text: thinking }] : []),
      ...(text ? [{ type: "text" as const, text }] : [])
    ]
  };
}
