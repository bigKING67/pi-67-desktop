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
  mentionCount: number;
  ownerUserId?: string;
  lastMessageAt?: number;
  lastSenderUserId?: string;
  lastPreview?: string;
  createdAt: number;
}

interface MockWorkCard {
  id: string;
  conversationId: string;
  createdBy: string;
  assigneeUserId?: string;
  claimedBy?: string;
  title: string;
  goal: string;
  acceptance: string;
  summary: string;
  refs: Array<{ kind: string; label: string; url?: string }>;
  status: string;
  revision: number;
  createdAt: number;
  updatedAt: number;
}

interface MockMessage {
  id: string;
  conversationId: string;
  seq: number;
  senderUserId: string;
  body: string;
  clientKey: string;
  createdAt: number;
  workCard?: MockWorkCard;
  mentionUserIds?: string[];
  agentInvocations?: Array<{ id: string; agentUserId: string; status: string; reason?: string }>;
}

interface MockAgent {
  userId: string; name: string; description: string; ownerUserId: string; modelLabel: string; dailyLimit: number;
  status: "active" | "disabled"; disabledByAdmin: boolean; online: boolean; createdAt: number;
}

export interface MockTeamChatState {
  connection: Record<string, unknown>;
  directory: {
    teamId: string;
    selfUserId: string;
    members: Array<{ userId: string; displayName: string; role: string }>;
    conversations: MockConversation[];
    policy: { channelCreation: string; viewersCanPost: boolean; retentionDays?: number; agentCreation: string; revision: number };
    agents: MockAgent[];
    bots: Array<{ userId: string; name: string; conversationId: string }>;
  };
  webhooks: Array<{ botUserId: string; conversationId: string; channelName: string; name: string; createdBy: string; createdAt: number }>;
  agentHost: { bindings: unknown[]; activity: unknown[] };
  messages: Record<string, MockMessage[]>;
  rosters: Record<string, string[]>;
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
    { id: "msg-4", conversationId: "conv-research", seq: 4, senderUserId: "user-li", body: "@高乾 顺便把港股那几家的口径对齐一下。", clientKey: "seed-key-0004", createdAt: start + 3_600_000, mentionUserIds: [self] }
  ];
  const liCard: MockWorkCard = {
    id: "card-li-1", conversationId: "dm-li", createdBy: "user-li", assigneeUserId: self, title: "港股口径对齐",
    goal: "统一三家港股公司的营收口径", acceptance: "口径表通过复核", summary: "原始数据在共享盘 Q3 文件夹",
    refs: [{ kind: "branch", label: "data/hk-alignment" }], status: "todo", revision: 1,
    createdAt: start + 7_200_000, updatedAt: start + 7_200_000
  };
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
        { id: "conv-research", kind: "channel", visibility: "public", name: "宏观研究", joined: true, memberCount: 4,
          memberUserIds: [], lastSeq: 4, lastReadSeq: 3, unreadCount: 1, mentionCount: 1, ownerUserId: "user-wang",
          lastMessageAt: start + 3_600_000, lastSenderUserId: "user-li", lastPreview: "@高乾 顺便把港股那几家的口径对齐一下。",
          createdAt: start - 86_400_000 },
        { id: "conv-ops", kind: "channel", visibility: "public", name: "交易复盘", joined: false, memberCount: 2,
          memberUserIds: [], lastSeq: 0, lastReadSeq: 0, unreadCount: 0, mentionCount: 0, ownerUserId: "user-li",
          createdAt: start - 3_600_000 },
        { id: "dm-li", kind: "dm", visibility: "private", joined: true, memberCount: 2, memberUserIds: [self, "user-li"].sort(),
          lastSeq: 1, lastReadSeq: 1, unreadCount: 0, mentionCount: 0, lastMessageAt: start + 7_200_000, lastSenderUserId: "user-li",
          lastPreview: "港股口径对齐", createdAt: start }
      ],
      policy: { channelCreation: "members", viewersCanPost: true, agentCreation: "members", revision: 0 },
      agents: [{ userId: "agent-macro", name: "宏观助手", description: "回答宏观数据问题", ownerUserId: "user-li",
        modelLabel: "anthropic · claude-sonnet", dailyLimit: 50, status: "active", disabledByAdmin: false, online: true, createdAt: start }],
      bots: [{ userId: "bot-ci", name: "CI 通知", conversationId: "conv-research" }]
    },
    webhooks: [],
    agentHost: { bindings: [], activity: [] },
    rosters: { "conv-research": [self, "user-wang", "user-li", "agent-macro"], "conv-ops": ["user-wang", "user-li"] },
    messages: {
      "conv-research": history,
      "dm-li": [{ id: "msg-card-1", conversationId: "dm-li", seq: 1, senderUserId: "user-li", body: "港股口径对齐",
        clientKey: "seed-card-0001", createdAt: start + 7_200_000, workCard: liCard }]
    }
  };
  let nextId = 100;

  const conversation = (id: unknown) => state.directory.conversations.find((item) => item.id === id);
  const append = (conversationId: string, senderUserId: string, body: string, clientKey: string, mentions?: unknown): MockMessage => {
    const target = conversation(conversationId)!;
    const message: MockMessage = { id: `msg-${nextId++}`, conversationId, seq: target.lastSeq + 1, senderUserId, body, clientKey,
      createdAt: Date.now(), ...(Array.isArray(mentions) && mentions.length > 0 ? { mentionUserIds: mentions as string[] } : {}) };
    const addressed = state.directory.agents.filter((agent) => agent.status === "active"
      && (message.mentionUserIds?.includes(agent.userId) || (target.kind === "dm" && target.memberUserIds.includes(agent.userId))));
    if (senderUserId === self && addressed.length > 0) {
      message.agentInvocations = addressed.map((agent) => ({ id: `inv-${nextId++}`, agentUserId: agent.userId, status: "queued" }));
    }
    (state.messages[conversationId] ??= []).push(message);
    Object.assign(target, { lastSeq: message.seq, lastMessageAt: message.createdAt, lastSenderUserId: senderUserId,
      lastPreview: body.slice(0, 140) });
    if (senderUserId === self) Object.assign(target, { lastReadSeq: message.seq, unreadCount: 0, mentionCount: 0 });
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
        return existing ?? append(String(payload.conversationId), self, String(payload.body), String(payload.clientKey), payload.mentionUserIds);
      }
      case "teamChat.read.mark": {
        const target = conversation(payload.conversationId)!;
        target.lastReadSeq = Math.max(target.lastReadSeq, Math.min(Number(payload.lastReadSeq), target.lastSeq));
        if (target.lastReadSeq >= target.lastSeq) Object.assign(target, { unreadCount: 0, mentionCount: 0 });
        return { lastReadSeq: target.lastReadSeq };
      }
      case "teamChat.channel.create": {
        const created: MockConversation = { id: `conv-${nextId++}`, kind: "channel", visibility: payload.visibility as "public",
          name: String(payload.name), joined: true, memberCount: 1 + (payload.memberUserIds as string[]).length,
          memberUserIds: [], lastSeq: 0, lastReadSeq: 0, unreadCount: 0, mentionCount: 0, ownerUserId: self, createdAt: Date.now() };
        state.directory.conversations.push(created);
        state.rosters[created.id] = [self, ...(payload.memberUserIds as string[])];
        return created;
      }
      case "teamChat.channel.join": {
        const target = conversation(payload.conversationId)!;
        Object.assign(target, { joined: true, memberCount: target.memberCount + 1 });
        (state.rosters[target.id] ??= []).push(self);
        return target;
      }
      case "teamChat.channel.members": {
        const target = conversation(payload.conversationId)!;
        return { ownerUserId: target.ownerUserId, members: (state.rosters[target.id] ?? []).map((userId) => ({ userId, joinedAt: start })) };
      }
      case "teamChat.channel.manage": {
        const target = conversation(payload.conversationId)!;
        const action = payload.action as { type: string; name?: string; userId?: string; userIds?: string[] };
        const roster = state.rosters[target.id] ??= [];
        const remove = (userId: string) => {
          if (userId === target.ownerUserId) throw Object.assign(new Error("owner"), { details: { serviceError: "chat_owner_must_transfer" } });
          state.rosters[target.id] = roster.filter((item) => item !== userId);
          target.memberCount = state.rosters[target.id]!.length;
          if (userId === self) target.joined = false;
        };
        if (action.type === "rename") target.name = action.name!;
        if (action.type === "archive") state.directory.conversations = state.directory.conversations.filter((item) => item !== target);
        if (action.type === "addMembers") { roster.push(...action.userIds!); target.memberCount = roster.length; }
        if (action.type === "removeMember") remove(action.userId!);
        if (action.type === "leave") remove(self);
        if (action.type === "transferOwner") target.ownerUserId = action.userId!;
        return {};
      }
      case "teamChat.workCard.create": {
        const conversationId = String(payload.conversationId);
        const existing = (state.messages[conversationId] ?? []).find((message) => message.clientKey === payload.clientKey);
        if (existing) return existing;
        const message = append(conversationId, self, String(payload.title), String(payload.clientKey));
        message.workCard = {
          id: `card-${nextId++}`, conversationId, createdBy: self,
          ...(typeof payload.assigneeUserId === "string" ? { assigneeUserId: payload.assigneeUserId } : {}),
          title: String(payload.title), goal: String(payload.goal), acceptance: String(payload.acceptance),
          summary: String(payload.summary), refs: payload.refs as MockWorkCard["refs"], status: "todo", revision: 1,
          createdAt: message.createdAt, updatedAt: message.createdAt
        };
        return message;
      }
      case "teamChat.workCard.act": {
        const card = Object.values(state.messages).flat().map((message) => message.workCard)
          .find((candidate) => candidate?.id === payload.cardId);
        if (!card || card.revision !== payload.expectedRevision) throw new Error("work_card_revision_conflict");
        const next: Record<string, string> = { claim: "in_progress", submit_for_review: "in_review", accept: "done",
          request_changes: "in_progress", close: "closed", reopen: "todo" };
        card.status = next[String(payload.action)]!;
        if (payload.action === "claim") card.claimedBy = self;
        if (payload.action === "reopen") delete card.claimedBy;
        card.revision += 1;
        card.updatedAt = Date.now();
        return card;
      }
      case "teamChat.agent.create": {
        const agent: MockAgent = { userId: `agent-${nextId++}`, name: String(payload.name), description: String(payload.description),
          ownerUserId: self, modelLabel: "", dailyLimit: 50, status: "active", disabledByAdmin: false, online: false, createdAt: Date.now() };
        state.directory.agents.push(agent);
        return agent;
      }
      case "teamChat.agent.update": {
        const agent = state.directory.agents.find((item) => item.userId === payload.agentUserId)!;
        Object.assign(agent, Object.fromEntries(Object.entries(payload).filter(([key]) => key !== "agentUserId")));
        return agent;
      }
      case "teamChat.agent.setDisabled": {
        const agent = state.directory.agents.find((item) => item.userId === payload.agentUserId)!;
        agent.status = payload.disabled ? "disabled" : "active";
        return agent;
      }
      case "teamChat.agent.remove":
        state.directory.agents = state.directory.agents.filter((item) => item.userId !== payload.agentUserId);
        return {};
      case "teamChat.agent.host.get": return state.agentHost;
      case "teamChat.agent.host.bind": {
        const binding = payload.binding as { agentUserId: string; model: { provider: string; id: string } };
        state.agentHost = { ...state.agentHost, bindings: [...state.agentHost.bindings.filter((item) => (item as { agentUserId: string }).agentUserId !== binding.agentUserId), binding] };
        const agent = state.directory.agents.find((item) => item.userId === binding.agentUserId);
        if (agent) Object.assign(agent, { online: true, modelLabel: `${binding.model.provider} · ${binding.model.id}` });
        return state.agentHost;
      }
      case "teamChat.agent.host.unbind":
        state.agentHost = { ...state.agentHost, bindings: state.agentHost.bindings.filter((item) => (item as { agentUserId: string }).agentUserId !== payload.agentUserId) };
        return state.agentHost;
      case "teamChat.webhook.list":
        return { webhooks: state.webhooks.filter((item) => item.conversationId === payload.conversationId) };
      case "teamChat.webhook.create":
      case "teamChat.webhook.rotate": {
        let webhook = state.webhooks.find((item) => item.botUserId === payload.botUserId);
        if (!webhook) {
          webhook = { botUserId: `bot-${nextId++}`, conversationId: String(payload.conversationId), channelName: "宏观研究",
            name: String(payload.name), createdBy: self, createdAt: Date.now() };
          state.webhooks.push(webhook);
          state.directory.bots.push({ userId: webhook.botUserId, name: webhook.name, conversationId: webhook.conversationId });
        }
        return { webhook, url: `https://newmoney.example.test/v1/hooks/chat/${webhook.botUserId}/secret-${nextId++}` };
      }
      case "teamChat.webhook.remove":
        state.webhooks = state.webhooks.filter((item) => item.botUserId !== payload.botUserId);
        state.directory.bots = state.directory.bots.filter((item) => item.userId !== payload.botUserId);
        return {};
      case "teamChat.dm.open": {
        const existing = state.directory.conversations.find((item) => item.kind === "dm" && item.memberUserIds.includes(String(payload.userId)));
        if (existing) return existing;
        const created: MockConversation = { id: `dm-${nextId++}`, kind: "dm", visibility: "private", joined: true, memberCount: 2,
          memberUserIds: [self, String(payload.userId)].sort(), lastSeq: 0, lastReadSeq: 0, unreadCount: 0, mentionCount: 0,
          createdAt: Date.now() };
        state.directory.conversations.push(created);
        return created;
      }
      default: return undefined;
    }
  };
}
