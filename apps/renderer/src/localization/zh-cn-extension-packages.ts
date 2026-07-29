const KNOWN_PACKAGE_PURPOSES: Readonly<Record<string, string>> = Object.freeze({
  "@feniix/pi-sequential-thinking": "为 Pi 提供分阶段的结构化渐进思考，也可作为 MCP stdio 服务运行。",
  "@ff-labs/pi-fff": "为 Pi 提供基于 FFF 的文件与内容模糊搜索。",
  "@juicesharp/rpiv-advisor": "允许 Pi 在执行前请求更强的审阅模型提供第二意见。",
  "@juicesharp/rpiv-ask-user-question": "允许 Pi 在需要澄清时展示带类型选项的结构化问卷，避免自行猜测。",
  "@narumitw/pi-btw": "为 Pi 添加 `/btw` 旁支提问命令。",
  "@narumitw/pi-plan-mode": "为 Pi 添加类似 Codex 的只读 `/plan` 协作模式。",
  "@victor-software-house/pi-curated-themes": "为 Pi 提供精选深色终端主题，配色改编自 iTerm2-Color-Schemes。",
  "pi-markdown-preview": "为 Pi 提供 Markdown 与 LaTeX 预览，支持终端、浏览器和 PDF 输出。",
  "pi-mcp-adapter": "让 Pi 连接并调用 Model Context Protocol（MCP）服务。",
  "pi-observational-memory": "为 Pi 提供观察式记忆，通过观察与反思进行便于缓存的分层压缩。",
  "pi-rewind": "为 Pi 提供检查点与回退能力，支持逐工具快照、安全恢复和重做。",
  "pi-simplify": "审查近期修改的代码，帮助提升清晰度、一致性和可维护性。",
  "pi-smart-fetch": "提供智能网页抓取，使用桌面浏览器 TLS 特征并提取干净正文。",
  "pi-subagents": "将任务委派给子代理，支持任务链、并行执行和交互式澄清。",
  "pi-until-done": "为 Pi 提供证据驱动的目标循环，结合 TDD 规划、验证与强制评审。",
  "pi-web-access": "为 Pi 提供网页搜索、URL 抓取、GitHub 仓库克隆、PDF 提取以及视频理解与分析。"
});

const HAN_TEXT = /[\u3400-\u9fff]/u;

export const zhCNExtensionPackageMessages = {
  purpose(source: string, displayName: string | undefined, manifestDescription: string | undefined): string {
    for (const identity of packageIdentityCandidates(source, displayName)) {
      const localized = KNOWN_PACKAGE_PURPOSES[identity];
      if (localized) return localized;
    }

    const description = manifestDescription?.trim();
    if (description && HAN_TEXT.test(description)) return description;
    if (description) {
      return "该扩展的本地包清单提供了功能说明，但暂未收录对应中文文案。可在“当前会话”中查看 Pi Runtime 实际加载的能力。";
    }
    return "该扩展没有在本地包清单中提供功能说明。可在“当前会话”中查看 Pi Runtime 实际加载的能力。";
  }
} as const;

function packageIdentityCandidates(source: string, displayName: string | undefined): string[] {
  const identities = new Set<string>();
  if (displayName?.trim()) identities.add(stripPackageVersion(displayName.trim()));

  const normalizedSource = source.trim();
  if (normalizedSource.startsWith("npm:")) {
    identities.add(stripPackageVersion(normalizedSource.slice(4)));
  } else {
    const sourceWithoutRevision = normalizedSource.split(/[?#]/u, 1)[0] ?? normalizedSource;
    const normalizedPath = sourceWithoutRevision.replaceAll("\\", "/").replace(/\/+$/u, "");
    const basename = normalizedPath.split("/").at(-1)?.replace(/\.git$/u, "");
    if (basename) identities.add(stripPackageVersion(basename));
  }
  return [...identities];
}

function stripPackageVersion(identity: string): string {
  if (identity.startsWith("@")) {
    const separator = identity.indexOf("@", identity.indexOf("/") + 1);
    return separator > 0 ? identity.slice(0, separator) : identity;
  }
  const separator = identity.lastIndexOf("@");
  return separator > 0 ? identity.slice(0, separator) : identity;
}
