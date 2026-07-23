import { Command, HeartPulse, KeyRound, PackageOpen, RefreshCw, Scissors } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Dialog, Heading, Input, Modal, ModalOverlay } from "react-aria-components";
import { useAppStore } from "../app/app-store.js";

interface PaletteAction {
  id: string;
  label: string;
  detail: string;
  icon: typeof Command;
  run: () => Promise<void> | void;
}

export function CommandPalette() {
  const open = useAppStore((state) => state.commandPaletteOpen);
  const setOpen = useAppStore((state) => state.setCommandPaletteOpen);
  const compact = useAppStore((state) => state.compact);
  const reload = useAppStore((state) => state.reloadResources);
  const saveDiagnostics = useAppStore((state) => state.saveDiagnostics);
  const runDoctor = useAppStore((state) => state.runDoctor);
  const setCredentialDialogOpen = useAppStore((state) => state.setCredentialDialogOpen);
  const client = useAppStore((state) => state.client);
  const invokeCommand = useAppStore((state) => state.invokeCommand);
  const [query, setQuery] = useState("");
  const [extensionCommands, setExtensionCommands] = useState<Array<{ name: string; description?: string }>>([]);
  const [extensionCommandsUnavailable, setExtensionCommandsUnavailable] = useState(false);

  useEffect(() => {
    if (!open || !client) return;
    setQuery("");
    setExtensionCommandsUnavailable(false);
    void client.request<"command.list", unknown>("command.list", {})
      .then((value) => {
        const commands = parseExtensionCommands(value);
        setExtensionCommands(commands ?? []);
        setExtensionCommandsUnavailable(commands === undefined);
      })
      .catch(() => {
        setExtensionCommands([]);
        setExtensionCommandsUnavailable(true);
      });
  }, [client, open]);

  const actions = useMemo<PaletteAction[]>(() => [
    { id: "reload", label: "重新加载 Pi 资源", detail: "Skills、Prompts、Extensions 和上下文文件", icon: RefreshCw, run: reload },
    { id: "compact", label: "压缩当前会话", detail: "使用 Pi compaction 释放上下文空间", icon: Scissors, run: compact },
    { id: "diagnostics", label: "导出脱敏诊断", detail: "不包含凭据、Prompt 和源码正文", icon: PackageOpen, run: saveDiagnostics },
    { id: "doctor", label: "运行环境 Doctor", detail: "检查内置 Node、Pi SDK、Shell 和 Git", icon: HeartPulse, run: runDoctor },
    { id: "runtime-key", label: "配置 Provider API key", detail: "只在本次运行内存中使用，不写入磁盘", icon: KeyRound, run: () => setCredentialDialogOpen(true) },
    ...extensionCommands.map((item) => ({ id: `extension-${item.name}`, label: `/${item.name}`, detail: item.description ?? "Pi extension command", icon: Command, run: () => invokeCommand(item.name) }))
  ], [compact, extensionCommands, invokeCommand, reload, runDoctor, saveDiagnostics, setCredentialDialogOpen]);
  const visible = actions.filter((action) => `${action.label} ${action.detail}`.toLowerCase().includes(query.toLowerCase()));

  if (!open) return null;
  return (
    <ModalOverlay className="modal-overlay palette-overlay" isOpen isDismissable onOpenChange={setOpen}>
      <Modal className="command-palette">
        <Dialog aria-label="命令面板">
          <Heading slot="title" className="sr-only">命令面板</Heading>
          <div className="palette-search"><Command size={17} /><Input autoFocus aria-label="搜索命令" placeholder="搜索 Pi 命令或应用操作…" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
          <div className="palette-results">
            {visible.map((action) => (
              <button type="button" key={action.id} onClick={() => {
                setOpen(false);
                void action.run();
              }}>
                <action.icon size={16} />
                <span><strong>{action.label}</strong><small>{action.detail}</small></span>
              </button>
            ))}
            {visible.length === 0 ? <p>没有匹配的命令。</p> : null}
            {extensionCommandsUnavailable ? <p role="status">Pi extension 命令暂时不可用，应用操作仍可使用。</p> : null}
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}

function parseExtensionCommands(value: unknown): Array<{ name: string; description?: string }> | undefined {
  if (!Array.isArray(value)) return undefined;
  const commands: Array<{ name: string; description?: string }> = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null || !("name" in item) || typeof item.name !== "string") return undefined;
    const description = "description" in item && typeof item.description === "string" ? item.description : undefined;
    commands.push({ name: item.name, ...(description === undefined ? {} : { description }) });
  }
  return commands;
}
