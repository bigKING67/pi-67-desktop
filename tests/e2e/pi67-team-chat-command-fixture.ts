export type MockTeamChatCommandHandler = (
  type: string,
  payload: Record<string, unknown>
) => unknown;

interface MockConversation {
  id: string;
  kind: "channel" | "dm";
  visibility: "public" | "private";
  name?: string;
  joined: boolean;
  memberCount: number;
  memberUserIds: string[];
  lastSeq: number;
  lastReadSeq: number;
  unreadCount: number;
  lastMessageAt?: number;
  lastSenderUserId?: string;
  lastPreview?: string;
  createdAt: number;
}

interface MockMessage {
  id: string;
  conversationId: string;
  seq: number;
  senderUserId: string;
  body: string;
  clientKey: string;
  createdAt: number;
}

export interface MockTeamChatState {
  connection: Record<string, unknown>;
  directory: {
    teamId: string;
    selfUserId: string;
    members: Array<{ userId: string; displayName: string; role: string }>;
    conversations: MockConversation[];
  };
  messages: Record<string, MockMessage[]>;
}

/** Stateful New Money Team Chat stand-in. Signed out by default so Work-only specs are unaffected. */
export function installMockTeamChatCommandHandler(): void {
  const testWindow = window as Window & typeof globalThis & {
    __pi67ResolveMockTeamChatCommand?: MockTeamChatCommandHandler;
    __pi67MockTeamChat?: MockTeamChatState;
  };
  const start = new Date(2026, 9, 1, 9, 0).getTime();
  const self = "user-self";
  const history: MockMessage[] = [
    { id: "msg-1", conversationId: "conv-research", seq: 1, senderUserId: "user-wang", body: "宏观周报草稿已经放到工作区了，今天下午能帮忙看一下估值部分吗？", clientKey: "seed-key-0001", createdAt: start },
    { id: "msg-2", conversationId: "conv-research", seq: 2, senderUserId: "user-wang", body: "重点是第三节的折现率假设。", clientKey: "seed-key-0002", createdAt: start + 60_000 },
    { id: "msg-3", conversationId: "conv-research", seq: 3, senderUserId: self, body: "可以，我先在工作里跑一遍敏感性分析。", clientKey: "seed-key-0003", createdAt: start + 600_000 },
    { id: "msg-4", conversationId: "conv-research", seq: 4, senderUserId: "user-li", body: "顺便把港股那几家的口径对齐一下。", clientKey: "seed-key-0004", createdAt: start + 3_600_000 }
  ];
  const state: MockTeamChatState = {
    connection: { status: "signed-out" },
    directory: {
      teamId: "team-1",
      selfUserId: self,
      members: [
        { userId: self, displayName: "高乾", role: "owner" },
        { userId: "user-wang", displayName: "王一凡", role: "member" },
        { userId: "user-li", displayName: "李若溪", role: "admin" }
      ],
      conversations: [
        { id: "conv-research", kind: "channel", visibility: "public", name: "宏观研究", joined: true, memberCount: 3,
          memberUserIds: [], lastSeq: 4, lastReadSeq: 3, unreadCount: 1, lastMessageAt: start + 3_600_000,
          lastSenderUserId: "user-li", lastPreview: "顺便把港股那几家的口径对齐一下。", createdAt: start - 86_400_000 },
        { id: "conv-ops", kind: "channel", visibility: "public", name: "交易复盘", joined: false, memberCount: 2,
          memberUserIds: [], lastSeq: 0, lastReadSeq: 0, unreadCount: 0, createdAt: start - 3_600_000 }
      ]
    },
    messages: { "conv-research": history }
  };
  let nextId = 100;

  const conversation = (id: unknown) => state.directory.conversations.find((item) => item.id === id);
  const append = (conversationId: string, senderUserId: string, body: string, clientKey: string): MockMessage => {
    const target = conversation(conversationId)!;
    const message = { id: `msg-${nextId++}`, conversationId, seq: target.lastSeq + 1, senderUserId, body, clientKey, createdAt: Date.now() };
    (state.messages[conversationId] ??= []).push(message);
    Object.assign(target, { lastSeq: message.seq, lastMessageAt: message.createdAt, lastSenderUserId: senderUserId,
      lastPreview: body.slice(0, 140) });
    if (senderUserId === self) Object.assign(target, { lastReadSeq: message.seq, unreadCount: 0 });
    return message;
  };

  testWindow.__pi67MockTeamChat = state;
  testWindow.__pi67ResolveMockTeamChatCommand = (type, payload) => {
    switch (type) {
      case "teamChat.connection.get": return state.connection;
      case "teamChat.directory.get": return state.directory;
      case "teamChat.messages.list": {
        const all = state.messages[String(payload.conversationId)] ?? [];
        const limit = typeof payload.limit === "number" ? payload.limit : 50;
        if (typeof payload.after === "number") {
          const newer = all.filter((message) => message.seq > (payload.after as number));
          return { messages: newer.slice(0, limit), hasMore: newer.length > limit };
        }
        const before = typeof payload.before === "number" ? payload.before : Number.MAX_SAFE_INTEGER;
        const older = all.filter((message) => message.seq < before);
        return { messages: older.slice(-limit), hasMore: older.length > limit };
      }
      case "teamChat.message.send": {
        const existing = (state.messages[String(payload.conversationId)] ?? [])
          .find((message) => message.clientKey === payload.clientKey);
        return existing ?? append(String(payload.conversationId), self, String(payload.body), String(payload.clientKey));
      }
      case "teamChat.read.mark": {
        const target = conversation(payload.conversationId)!;
        target.lastReadSeq = Math.max(target.lastReadSeq, Math.min(Number(payload.lastReadSeq), target.lastSeq));
        if (target.lastReadSeq >= target.lastSeq) target.unreadCount = 0;
        return { lastReadSeq: target.lastReadSeq };
      }
      case "teamChat.channel.create": {
        const created: MockConversation = { id: `conv-${nextId++}`, kind: "channel", visibility: payload.visibility as "public",
          name: String(payload.name), joined: true, memberCount: 1 + (payload.memberUserIds as string[]).length,
          memberUserIds: [], lastSeq: 0, lastReadSeq: 0, unreadCount: 0, createdAt: Date.now() };
        state.directory.conversations.push(created);
        return created;
      }
      case "teamChat.channel.join": {
        const target = conversation(payload.conversationId)!;
        Object.assign(target, { joined: true, memberCount: target.memberCount + 1 });
        return target;
      }
      case "teamChat.dm.open": {
        const existing = state.directory.conversations.find((item) => item.kind === "dm" && item.memberUserIds.includes(String(payload.userId)));
        if (existing) return existing;
        const created: MockConversation = { id: `dm-${nextId++}`, kind: "dm", visibility: "private", joined: true, memberCount: 2,
          memberUserIds: [self, String(payload.userId)].sort(), lastSeq: 0, lastReadSeq: 0, unreadCount: 0, createdAt: Date.now() };
        state.directory.conversations.push(created);
        return created;
      }
      default: return undefined;
    }
  };
}
