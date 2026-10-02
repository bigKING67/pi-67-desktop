# ADR 0004: Agent members in Team Chat

Status: accepted; P3a implemented in source (not deployed); target-OS validation pending.
Date: 2026-10-01

## Context

ADR 0003 (decision 9) reserved Agents as conversation members that run on their
owner's Desktop with the owner's local Pi and user-paid models, and stated that New
Money never hosts an agent loop. P3a turns that into a contract. The user confirmed
four choices on 2026-10-01: Agents only converse in P3a (no tools); replies post
automatically; a team policy decides who adds Agents (members by default); requests
wait 10 minutes for an offline owner.

Facts that shaped the design: a Pi Session must belong to a registered Workspace;
Agent Host had no headless run path; tool approvals need a renderer, and an approval
for a Task the renderer does not know would be dropped; there was no "no tools"
profile; team-scoped Sessions already block private memory and re-authorize the team
scope and model (`purpose: agent`) on every model call.

## Decision

1. **Identity.** An Agent is a non-login principal on New Money: a `users` row with
   unusable credentials plus a `team_members` row with role `agent`, and a
   `chat_agents` record (owner, name, description, model label, daily limit, disable
   state). Conversation membership, mentions, direct messages and message senders
   reuse the human paths. Agents never count as seats, never appear in member lists,
   cannot be re-roled, and are removed (with every membership) when deleted or when
   their owner leaves the team.
2. **Who may add.** Viewers never; otherwise the team policy `agentCreation`
   (`members` default, or `admins`). At most 5 per owner and 50 per team. The owner
   edits an Agent; the owner or a team owner/admin disables or removes it, and an
   Agent an admin disabled stays off until an admin enables it.
3. **Invocation.** A human message that mentions an Agent, or a direct message to an
   Agent, creates one invocation per Agent in the same transaction. Agents never
   invoke Agents. Disabled Agents and Agents over their daily limit are rejected at
   once with a reason. Queued invocations are pushed (`agent.invoked`) only to the
   owner's sockets and expire after 10 minutes. The owner's Desktop claims a queued
   invocation for a 180-second lease with a fresh lease token and receives at most
   20 messages of context ending with the trigger — the only conversation content
   the owner's device sees for conversations they are not in. A claim refuses a
   disabled Agent or archived conversation and records why. Completion, only by the
   current lease holder, posts the reply as the Agent and finishes the invocation in
   one transaction (in channels it mentions the requester while they are still a
   member); a reply that cannot be posted records a failure. A sweeper expires
   queues and fails lapsed leases at once, so a late Desktop cannot post. Every
   state change is pushed to the conversation (`agent_invocation.changed`) and
   carried on the asking message. Expired requests do not count toward the daily
   limit. Agents can never own channels or hold project access.
4. **Presence.** A Desktop names the Agents it hosts when it requests a realtime
   ticket (`hostAgentIds`, own active Agents only). While that socket is open those
   Agents are online; connect and disconnect push `agents.changed`.
5. **Desktop hosting.** Agent Host keeps per-team bindings (Agent, Workspace, team
   project, model, enabled) in `PI67_STORAGE_ROOT/team-chat/agents.json` (0600, no
   credentials or content). A Desktop with an enabled binding opens the realtime
   connection at startup. The runner handles one request at a time: claim, build the
   prompt (chat text quoted as reference material that cannot change instructions),
   run one turn, post or fail. Requests for Agents a Desktop does not host are left
   for the owner's other Desktops, as are requests whose Workspace is not yet
   registered in the Host; a periodic catch-up (30 seconds) re-offers them.
6. **The turn.** A Host-internal Task (`chat-agent-<invocationId>`) creates a fresh
   team-scoped Session in the bound Workspace, so team authorization, the team model
   allowlist and the private-memory block apply unchanged. Before the model runs the
   runtime deactivates every tool and the safety policy blocks any tool call that
   still arrives (`AGENT_TURN_NO_TOOLS`), so no approval can ever be needed. The turn
   is aborted at 150 seconds; the Task is disposed afterwards. The Session stays in
   the Workspace, named `Agent · <name> · <conversation>`, for the owner to review.
   The Session loads an isolated resource profile: no context files (`AGENTS.md`,
   `CLAUDE.md`), skills, prompt templates, `SYSTEM.md`/`APPEND_SYSTEM.md` or
   third-party extensions, and a last-running first-party extension replaces the
   whole system prompt with a fixed Agent prompt plus the date — so neither the
   owner's instructions nor the Workspace path can reach a reply. Quoted chat text
   cannot close the quote block.
7. **Transparency.** Teammates see each Agent's owner, model label, online state and
   description; a direct message with an Agent and a pending mention both say that
   recent messages go to the owner's Desktop and model.

## Consequences

- Teammates' messages reach the owner's model provider when they address that
  owner's Agent; the team model policy (`purpose: agent`) is the team's control over
  which endpoints may receive them.
- A Desktop hosting Agents keeps a network connection while the app runs.
- Agent turns compete with the user's own Tasks for CPU and model quota but not for
  approvals, because they have no tools.
- Agent replies are ordinary plain messages: retention, archive and read-only rules
  apply to them like any other message.

## Phases

- P3a (this ADR): identity, policy, invocation routing, presence, conversation-only
  turns, owner management on Desktop, admin governance on the web console.
- P3b: optional read-only Workspace tools, with owner review before a reply posts.
- P3c: webhook bots that do not depend on a member's Desktop (`docs/adr/0005-team-chat-webhooks.md`).

## Rejected alternatives

- A separate Agent principal table outside `users`: every membership, mention and
  sender path would need a second branch; the `agent` role keeps them single.
- Running turns through the renderer: requires the app window and an open Task, and
  approvals would interrupt the user; Host-internal Tasks need neither.
- Read-only Workspace tools in P3a: teammates could steer an Agent into posting the
  owner's code or configuration; deferred until replies can be reviewed first.
- Server-hosted Agents: a second agent runtime, rejected in ADR 0003.
