import type { SettingsSection } from "@pi67/domain";
import {
  Activity,
  Building2,
  ChartNoAxesCombined,
  Blocks,
  Bot,
  Eye,
  FileText,
  Globe,
  Info,
  Network,
  RefreshCw,
  Scale,
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
        searchTerms: ["账户与本地数据", "登录", "未登录", "本地数据", "本地模式", "account", "sign in"],
        icon: UserRound
      },
      {
        id: "general",
        ...messages.settings.sections.general,
        searchTerms: ["通用", "外观", "主题", "深色", "浅色", "跟随系统", "快捷键", "键盘", "shortcut", "keyboard", "appearance", "theme"],
        icon: SlidersHorizontal
      }
    ]
  },
  {
    label: messages.settings.groups.pi,
    items: [
      {
        id: "providers",
        ...messages.settings.sections.providers,
        searchTerms: ["模型服务", "提供商", "服务商", "认证", "密钥", "思考级别", "provider", "model", "api key"],
        icon: Bot
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
        icon: Blocks
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
        icon: Sparkles
      },
      {
        id: "prompts",
        ...messages.settings.sections.prompts,
        searchTerms: ["指令模板", "提示词模板", ".pi/prompts", "prompt", "prompts", "slash command"],
        icon: FileText
      },
      {
        id: "rules",
        ...messages.settings.sections.rules,
        searchTerms: ["规则与上下文", "规则", "上下文", "agents", "claude", "system", "rule", "rules", "行为约束"],
        icon: Scale
      }
    ]
  },
  {
    label: messages.settings.groups.office,
    items: [
      {
        id: "lark",
        ...messages.settings.sections.lark,
        searchTerms: [
          "飞书",
          "Lark",
          "Lark CLI",
          "用户授权",
          "飞书应用",
          "App ID",
          "App Secret",
          "OAuth",
          "云盘",
          "云空间",
          "日历",
          "消息",
          "任务",
          "邮箱"
        ],
        icon: Building2
      }
    ]
  },
  {
    label: messages.settings.groups.capabilities,
    items: [
      {
        id: "vision",
        ...messages.settings.sections.vision,
        searchTerms: [
          "视觉模型",
          "图片识别",
          "图像识别",
          "多模态",
          "Qwen VL",
          "豆包",
          "vision",
          "image"
        ],
        icon: Eye
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
        icon: Globe
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
        icon: Activity
      },
      {
        id: "usage",
        ...messages.settings.sections.usage,
        searchTerms: ["用量", "token", "cost", "usage", "模型", "provider", "jsonl", "成本"],
        icon: ChartNoAxesCombined
      },
      {
        id: "network",
        ...messages.settings.sections.network,
        searchTerms: ["镜像", "npm", "git", "node", "下载", "网络", "registry", "github"],
        icon: Network
      },
      {
        id: "updates",
        ...messages.settings.sections.updates,
        searchTerms: ["版本", "检查更新", "导出", "诊断", "update", "version", "doctor"],
        icon: RefreshCw
      },
      {
        id: "about",
        ...messages.settings.sections.about,
        searchTerms: ["版本", "架构", "pi", "jsonl", "electron", "about"],
        icon: Info
      }
    ]
  }
];

export const SETTINGS_SECTIONS = SETTINGS_GROUPS.flatMap((group) => group.items);

export function sectionSupportsProjectScope(section: SettingsSection): boolean {
  return section === "providers"
    || section === "vision"
    || section === "packages"
    || section === "extensions"
    || section === "prompts"
    || section === "usage";
}

export function matchesSettingsQuery(item: SettingsNavigationItem, query: string): boolean {
  if (!query) return true;
  return [item.label, item.summary, ...item.searchTerms]
    .some((value) => value.toLocaleLowerCase("zh-CN").includes(query));
}
