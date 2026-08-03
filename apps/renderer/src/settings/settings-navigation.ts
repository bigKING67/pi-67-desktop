import type { SettingsSection } from "@pi67/domain";
import {
  Activity,
  Blocks,
  Bot,
  FileText,
  Globe,
  Info,
  Network,
  RefreshCw,
  Scale,
  Server,
  SlidersHorizontal,
  Sparkles,
  UserRound
} from "lucide-react";
import { messages } from "../localization/message-catalog.js";

export interface SettingsNavigationItem {
  id: SettingsSection;
  label: string;
  summary: string;
  searchTerms: readonly string[];
  icon: typeof SlidersHorizontal;
  measure: "compact" | "standard";
}

export const SETTINGS_GROUPS: ReadonlyArray<{
  label: string;
  items: readonly SettingsNavigationItem[];
}> = [
  {
    label: messages.settings.groups.application,
    items: [
      {
        id: "account",
        ...messages.settings.sections.account,
        searchTerms: ["账户", "登录", "未登录", "本地数据", "本地模式", "account", "sign in"],
        icon: UserRound,
        measure: "compact"
      },
      {
        id: "general",
        ...messages.settings.sections.general,
        searchTerms: ["通用", "外观", "主题", "深色", "浅色", "跟随系统", "appearance", "theme"],
        icon: SlidersHorizontal,
        measure: "compact"
      }
    ]
  },
  {
    label: messages.settings.groups.pi,
    items: [
      {
        id: "providers",
        ...messages.settings.sections.providers,
        searchTerms: ["提供商", "服务商", "认证", "密钥", "思考级别", "provider", "model", "api key"],
        icon: Bot,
        measure: "standard"
      },
      {
        id: "extensions",
        ...messages.settings.sections.extensions,
        searchTerms: [
          "扩展包",
          "内置扩展",
          "本地扩展",
          "已加载扩展",
          "资源包",
          "插件",
          "安装",
          "更新",
          "卸载",
          ".pi/extensions",
          "npm",
          "git",
          "path",
          "package",
          "extension",
          "resource"
        ],
        icon: Blocks,
        measure: "standard"
      },
      {
        id: "skills",
        ...messages.settings.sections.skills,
        searchTerms: [
          "技能",
          "全局可用",
          "项目专属",
          "全局技能",
          "项目技能",
          "内置技能",
          "内置技能套件",
          "受管技能套件",
          "本地全局技能",
          ".agents/skills",
          ".pi/skills",
          "skill",
          "resource"
        ],
        icon: Sparkles,
        measure: "standard"
      },
      {
        id: "prompts",
        ...messages.settings.sections.prompts,
        searchTerms: ["指令模板", "提示词模板", ".pi/prompts", "prompt", "prompts", "slash command"],
        icon: FileText,
        measure: "standard"
      },
      {
        id: "rules",
        ...messages.settings.sections.rules,
        searchTerms: ["规则", "上下文", "agents", "claude", "system", "rule", "rules", "行为约束"],
        icon: Scale,
        measure: "standard"
      }
    ]
  },
  {
    label: messages.settings.groups.connections,
    items: [
      {
        id: "mcp",
        ...messages.settings.sections.mcp,
        searchTerms: [
          "mcp",
          "tavily",
          "client token",
          "认证",
          "端点",
          "中转",
          "搜索服务"
        ],
        icon: Server,
        measure: "compact"
      },
      {
        id: "integrations",
        ...messages.settings.sections.integrations,
        searchTerms: [
          "browser67",
          "浏览器",
          "依赖",
          "准备",
          "诊断",
          "setup",
          "doctor",
          "integration"
        ],
        icon: Globe,
        measure: "standard"
      }
    ]
  },
  {
    label: messages.settings.groups.systemSupport,
    items: [
      {
        id: "runtime",
        ...messages.settings.sections.runtime,
        searchTerms: ["运行", "会话", "并发", "恢复", "诊断", "runtime", "session"],
        icon: Activity,
        measure: "compact"
      },
      {
        id: "network",
        ...messages.settings.sections.network,
        searchTerms: ["镜像", "npm", "git", "node", "下载", "网络", "registry", "github"],
        icon: Network,
        measure: "standard"
      },
      {
        id: "updates",
        ...messages.settings.sections.updates,
        searchTerms: ["版本", "检查更新", "导出", "诊断", "update", "version", "doctor"],
        icon: RefreshCw,
        measure: "compact"
      },
      {
        id: "about",
        ...messages.settings.sections.about,
        searchTerms: ["版本", "架构", "pi", "jsonl", "electron", "about"],
        icon: Info,
        measure: "compact"
      }
    ]
  }
];

export const SETTINGS_SECTIONS = SETTINGS_GROUPS.flatMap((group) => group.items);

export function sectionSupportsProjectScope(section: SettingsSection): boolean {
  return section === "packages"
    || section === "extensions"
    || section === "prompts";
}

export function matchesSettingsQuery(item: SettingsNavigationItem, query: string): boolean {
  if (!query) return true;
  return [item.label, item.summary, ...item.searchTerms]
    .some((value) => value.toLocaleLowerCase("zh-CN").includes(query));
}
