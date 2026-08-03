import { Eye, EyeOff, KeyRound, RefreshCw, Save, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Input, TextField } from "react-aria-components";
import styles from "./TeamMcpPanel.module.css";
import {
  SettingsNotice,
  SettingsRow,
  SettingsRows,
  SettingsSectionBlock
} from "./SettingsPrimitives.js";
import { SettingsDestructiveActionDialog } from "./SettingsActionDialogs.js";
import { useSettingsDraftRegistration } from "./SettingsDraftGuard.js";

type TeamMcpStatus = Awaited<ReturnType<Window["pi67"]["system"]["getTeamMcpStatus"]>>;

const REVEAL_TTL_MS = 15_000;

export function TeamMcpPanel() {
  const [status, setStatus] = useState<TeamMcpStatus>();
  const [draft, setDraft] = useState("");
  const [draftVisible, setDraftVisible] = useState(false);
  const [revealedToken, setRevealedToken] = useState<string>();
  const [revealPending, setRevealPending] = useState(false);
  const [phase, setPhase] = useState<"idle" | "loading" | "saving" | "clearing">("idle");
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [clearOpen, setClearOpen] = useState(false);
  const mounted = useRef(false);

  useSettingsDraftRegistration({
    dirty: draft.length > 0,
    busy: phase === "saving",
    subject: "Tavily Bridge Client Token",
    discard: () => {
      setDraft("");
      setDraftVisible(false);
      setError(undefined);
    }
  });

  const hideRevealedToken = useCallback(() => {
    setRevealedToken(undefined);
  }, []);

  const refresh = useCallback(async () => {
    setPhase("loading");
    setError(undefined);
    hideRevealedToken();
    try {
      const next = await window.pi67.system.getTeamMcpStatus();
      if (!mounted.current) return;
      setStatus(next);
    } catch (loadError) {
      if (mounted.current) {
        setError(loadError instanceof Error ? loadError.message : "无法读取团队搜索配置");
      }
    } finally {
      if (mounted.current) setPhase("idle");
    }
  }, [hideRevealedToken]);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => {
      mounted.current = false;
    };
  }, [refresh]);

  // Auto-hide full token after a short window (same idea as provider credential reveal).
  useEffect(() => {
    if (revealedToken === undefined) return;
    const timeout = window.setTimeout(() => {
      if (mounted.current) setRevealedToken(undefined);
    }, REVEAL_TTL_MS);
    return () => window.clearTimeout(timeout);
  }, [revealedToken]);

  const save = async () => {
    setPhase("saving");
    setError(undefined);
    setNotice(undefined);
    hideRevealedToken();
    try {
      const next = await window.pi67.system.saveTeamMcpToken(draft);
      if (!mounted.current) return;
      setStatus(next);
      setDraft("");
      setDraftVisible(false);
      setNotice("已保存 Client Token，并重启了 Pi 运行服务以加载新凭据。");
    } catch (saveError) {
      if (mounted.current) {
        setError(saveError instanceof Error ? saveError.message : "保存失败");
      }
    } finally {
      if (mounted.current) setPhase("idle");
    }
  };

  const clear = async () => {
    setPhase("clearing");
    setError(undefined);
    setNotice(undefined);
    hideRevealedToken();
    try {
      const next = await window.pi67.system.clearTeamMcpToken();
      if (!mounted.current) return;
      setStatus(next);
      setDraft("");
      setDraftVisible(false);
      setClearOpen(false);
      setNotice("已清除本机 Token，并重启了 Pi 运行服务。在重新配置前，自建 Tavily 中转搜索将不可用。");
    } catch (clearError) {
      if (mounted.current) {
        setError(clearError instanceof Error ? clearError.message : "清除失败");
      }
    } finally {
      if (mounted.current) setPhase("idle");
    }
  };

  const toggleReveal = async () => {
    if (revealedToken !== undefined) {
      hideRevealedToken();
      return;
    }
    if (!status?.configured) return;
    setRevealPending(true);
    setError(undefined);
    try {
      const result = await window.pi67.system.revealTeamMcpToken();
      if (!mounted.current) return;
      if (result.status === "revealed") {
        setRevealedToken(result.token);
        return;
      }
      setError("未找到已保存的 Token，请重新保存。");
      setStatus((current) => current ? {
        serverName: current.serverName,
        url: current.url,
        tokenEnv: current.tokenEnv,
        tokenPath: current.tokenPath,
        configured: false
      } : current);
    } catch {
      if (mounted.current) setError("无法显示完整 Token");
    } finally {
      if (mounted.current) setRevealPending(false);
    }
  };

  const busy = phase !== "idle" || revealPending;
  const tokenVisible = revealedToken !== undefined;
  const currentTokenDisplay = tokenVisible
    ? revealedToken
    : status?.configured
      ? (status.tokenPrefix ?? "已配置")
      : "未设置";

  return (
    <>
    <SettingsSectionBlock
      actions={<Button className="secondary-button" isDisabled={busy} onPress={() => void refresh()}>
        <RefreshCw aria-hidden="true" size={14} />刷新
      </Button>}
      description="团队搜索 MCP · 通过自建中转连接。这里配置的是 Client Token，不是 Tavily 官方 tvly-… Key，也不会写入 pi-web-access。"
      title="Tavily Bridge"
    >
      {error ? <SettingsNotice tone="danger">{error}</SettingsNotice> : null}
      {notice ? <SettingsNotice tone="info">{notice}</SettingsNotice> : null}
      <SettingsRows>
        <SettingsRow
          leading={<span className={styles.status} data-status={status?.configured ? "ready" : "warning"} />}
          title="凭据状态"
          description="Token 只保存在本机 userData，不会打进安装包，也不会出现在投影日志中。"
          value={status?.configured ? "已配置" : "未配置"}
        />
        <SettingsRow
          title="连接状态"
          description="实际连接随 Pi 任务建立；请在任务的工具状态中查看真实 MCP 连接。"
          value="设置页未验证连接"
        />
        <SettingsRow
          title="MCP 端点"
          description="由 pi-mcp-adapter 连接；工具名通常为 tavily_bridge_tavily_search。"
          value={status?.url ?? "https://tavily.52671314.xyz/mcp"}
        />
        <SettingsRow
          title="当前 Token"
          description={status?.configured
            ? "默认只显示前缀；点眼睛可临时查看完整 Token（约 15 秒后自动隐藏）。"
            : "在管理后台创建 Client Token 后粘贴保存。"}
          actions={status?.configured ? (
            <div className={styles.tokenReveal}>
              <code className={`${styles.tokenValue} ${tokenVisible ? styles.tokenRevealed! : ""}`}>
                {currentTokenDisplay}
              </code>
              <Button
                aria-label={tokenVisible ? "隐藏完整 Token" : "显示完整 Token"}
                aria-pressed={tokenVisible}
                className={`secondary-button ${styles.eyeButton!}`}
                isDisabled={busy}
                onPress={() => void toggleReveal()}
              >
                {tokenVisible
                  ? <EyeOff aria-hidden="true" size={16} />
                  : <Eye aria-hidden="true" size={16} />}
              </Button>
            </div>
          ) : undefined}
          value={status?.configured ? undefined : "未设置"}
        />
        <SettingsRow
          leading={<KeyRound aria-hidden="true" size={17} />}
          title="Client Token"
          description="格式：mcp_<prefix>.<secret>。保存后会重启 Agent Host。"
          actions={<div className={styles.editor}>
            <div className={styles.secretInput}>
              <TextField
                aria-label="Tavily Bridge Client Token"
                className={styles.field!}
                value={draft}
                onChange={setDraft}
              >
                <Input
                  autoComplete="off"
                  className={styles.input!}
                  placeholder="mcp_xxxxxxxxxxxx.xxxxxxxx…"
                  spellCheck={false}
                  type={draftVisible ? "text" : "password"}
                />
              </TextField>
              <Button
                aria-label={draftVisible ? "隐藏输入内容" : "显示输入内容"}
                aria-pressed={draftVisible}
                className={`secondary-button ${styles.eyeButton!}`}
                isDisabled={busy}
                onPress={() => setDraftVisible((value) => !value)}
              >
                {draftVisible
                  ? <EyeOff aria-hidden="true" size={16} />
                  : <Eye aria-hidden="true" size={16} />}
              </Button>
            </div>
            <div className={styles.actions}>
              <Button
                className="primary-button"
                isDisabled={busy || draft.trim().length === 0}
                onPress={() => void save()}
              >
                <Save aria-hidden="true" size={14} />{phase === "saving" ? "保存中…" : "保存"}
              </Button>
              <Button
                className="secondary-button"
                isDisabled={busy || !status?.configured}
                onPress={() => setClearOpen(true)}
              >
                <Trash2 aria-hidden="true" size={14} />{phase === "clearing" ? "清除中…" : "清除"}
              </Button>
            </div>
          </div>}
        />
        <SettingsRow
          leading={<EyeOff aria-hidden="true" size={17} />}
          title="与 pi-web-access 的关系"
          description="web_search / fetch_content 走 pi-web-access 自己的 provider 配置；本 Token 只给 tavily-bridge MCP 使用。"
          value="分离"
        />
      </SettingsRows>
    </SettingsSectionBlock>
    <SettingsDestructiveActionDialog
      busy={phase === "clearing"}
      confirmLabel="清除 Client Token"
      description="这会删除 Pi-67 userData 中保存的 Tavily Bridge Client Token，并重启 Pi 运行服务以移除凭据。"
      error={clearOpen ? error : undefined}
      facts={[
        { label: "MCP 服务", value: status?.serverName ?? "Tavily Bridge" },
        { label: "存储位置", value: "Pi-67 userData" },
        { label: "运行服务", value: "确认后重启" }
      ]}
      open={clearOpen}
      pendingLabel="正在清除…"
      title="清除 MCP Client Token？"
      onCancel={() => setClearOpen(false)}
      onConfirm={() => void clear()}
    />
    </>
  );
}
