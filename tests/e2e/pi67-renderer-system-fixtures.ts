import type { DesktopCapabilitySnapshot, PackageNetworkSnapshot } from "@pi67/protocol";

export function createMockPackageNetworkSnapshot(): PackageNetworkSnapshot {
  return {
    settings: { npmMode: "automatic", gitMode: "automatic", gitMirrors: ["gitclone", "ghproxy"] },
    toolchain: {
      ready: true,
      packaged: false,
      platform: "darwin",
      architecture: "arm64",
      nodeVersion: "24.18.0",
      npmVersion: "12.0.1",
      gitVersion: "2.53.0"
    },
    sources: [
      { id: "npm-public-mirror", kind: "npm", role: "public-mirror", url: "https://registry.npmmirror.com", status: "not-checked" },
      { id: "npm-official", kind: "npm", role: "official", url: "https://registry.npmjs.org", status: "not-checked" },
      { id: "git-gitclone", kind: "git", role: "public-mirror", url: "https://gitclone.com/github.com/arpagon/pi-rewind.git", status: "not-checked" },
      { id: "git-official", kind: "git", role: "official", url: "https://github.com/arpagon/pi-rewind.git", status: "not-checked" }
    ]
  };
}

export function createMockDesktopCapabilitySnapshot(): DesktopCapabilitySnapshot {
  const bundledSkills = [{
    id: "lark-doc",
    displayName: "lark-doc",
    description: "读取、创建和编辑飞书云文档。",
    packageId: "pi-workspace-resources",
    packageDisplayName: "Pi Workspace Resources",
    version: "1.0.0",
    installed: true
  }, {
    id: "lark-calendar",
    displayName: "lark-calendar",
    description: "管理飞书日历、日程、忙闲状态和会议室。",
    packageId: "pi-workspace-resources",
    packageDisplayName: "Pi Workspace Resources",
    version: "1.0.0",
    installed: true
  }, {
    id: "investment-research",
    displayName: "investment-research",
    description: "投资研究综合分析框架。",
    packageId: "pi-workspace-resources",
    packageDisplayName: "Pi Workspace Resources",
    version: "1.0.0",
    installed: true
  }, {
    id: "commerce-growth-os",
    displayName: "commerce-growth-os",
    description: "全域电商经营综合诊断和增长方案。",
    packageId: "commerce-growth-os",
    packageDisplayName: "commerce-growth-os",
    version: "2.2.0",
    installed: true
  }, {
    id: "browser67",
    displayName: "browser67",
    description: "真实浏览器运行和自动化能力。",
    packageId: "browser67",
    packageDisplayName: "browser67",
    version: "0.8.0",
    installed: true
  }, {
    id: "js-reverse",
    displayName: "js-reverse",
    description: "浏览器 JavaScript 逆向和证据化分析。",
    packageId: "browser67",
    packageDisplayName: "browser67",
    version: "0.8.0",
    installed: true
  }, {
    id: "design-craft",
    displayName: "design-craft",
    description: "产品界面和交互设计工程能力。",
    packageId: "design-craft",
    packageDisplayName: "design-craft",
    version: "0.6.1",
    installed: true
  }, {
    id: "minimalist-ui",
    displayName: "minimalist-ui",
    description: "简洁的编辑式界面设计方向。",
    packageId: "pi-workspace-resources",
    packageDisplayName: "Pi Workspace Resources",
    version: "1.0.0",
    installed: true
  }];
  return {
    phase: "ready",
    catalogVersion: "2026.09.01.1",
    packages: [{
      id: "pi-workspace-resources",
      displayName: "Pi Workspace Resources",
      origin: "first-party",
      bundled: true,
      defaultEnabled: true,
      version: "1.0.0",
      internalPath: "packages/pi-workspace-resources",
      sourceTreeSha256: "ec4519c85610848e345784454763b90833bd4726939005a2d971fae2a44a9b11",
      resourceTypes: ["extension", "skill", "prompt", "rule"],
      installed: true
    }, {
      id: "openviking-pi-extension",
      displayName: "OpenViking Pi Extension",
      origin: "first-party",
      bundled: true,
      defaultEnabled: true,
      version: "0.2.0-desktop.1",
      internalPath: "packages/openviking-pi-extension",
      sourceTreeSha256: "373b0c4243f87236b41c343615ab771c7718b35dadc283a15eaf3d55c9c19a87",
      resourceTypes: ["extension", "context", "memory", "experience"],
      installed: true
    }, {
      id: "browser67",
      displayName: "browser67",
      origin: "first-party",
      bundled: true,
      defaultEnabled: true,
      version: "0.8.0",
      commit: "c9d45ae020ca502390b4b4838d924ace0d8e60d7",
      resourceTypes: ["skill", "integration"],
      installed: true
    }, {
      id: "design-craft",
      displayName: "design-craft",
      origin: "first-party",
      bundled: true,
      defaultEnabled: true,
      version: "0.6.1",
      commit: "b1688725876fa8624251c46763eddc4f4a8e2c52",
      resourceTypes: ["skill"],
      installed: true
    }, {
      id: "commerce-growth-os",
      displayName: "commerce-growth-os",
      origin: "first-party",
      bundled: true,
      defaultEnabled: true,
      version: "2.2.0",
      commit: "1c28f48ef002ce7dea18bbf5746eb9b4c2876971",
      resourceTypes: ["skill"],
      installed: true
    }],
    bundledExtensions: [{
      id: "pi-rules-loader",
      displayName: "工作规则加载器",
      description: "根据当前任务自动匹配并加载已配置的工作规则。",
      packageId: "pi-workspace-resources",
      packageDisplayName: "Pi Workspace Resources",
      version: "1.0.0",
      installed: true
    }, {
      id: "pi67-openviking",
      displayName: "OpenViking 上下文与记忆",
      description: "为 Pi TUI 与 Pi-67 Desktop 提供同一套上下文、私人记忆和任务经验能力。",
      packageId: "openviking-pi-extension",
      packageDisplayName: "OpenViking Pi Extension",
      version: "0.2.0-desktop.1",
      installed: true
    }],
    bundledSkills,
    bundledSkillSuites: [{
      id: "lark-cli",
      displayName: "飞书 Lark CLI",
      description: "飞书文档、消息、日历、任务、会议和开放平台能力。",
      versionSource: "unversioned",
      upstream: "https://github.com/larksuite/cli",
      updatePolicy: "hybrid",
      updateManager: "lark-cli",
      independentUpdateState: "available",
      skills: bundledSkills.slice(0, 2)
    }, {
      id: "ai-berkshire-investment-suite",
      displayName: "AI Berkshire 投资研究",
      description: "公司研究、财务分析和组合管理能力。",
      versionSource: "skill-pack",
      bundledVersion: "1.1.1",
      upstream: "https://github.com/xbtlin/ai-berkshire",
      sourceCommit: "fd83d06347c6e3ee50133cda6962f40e226b5252",
      updatePolicy: "capability-package",
      updateManager: "desktop-capability",
      independentUpdateState: "not-applicable",
      skills: bundledSkills.slice(2, 3)
    }, {
      id: "commerce-growth-os",
      displayName: "Commerce Growth OS",
      description: "电商经营、品牌、内容、增长和经营分析能力。",
      versionSource: "capability-package",
      bundledVersion: "2.2.0",
      upstream: "https://github.com/bigKING67/commerce-growth-os",
      sourceCommit: "1c28f48ef002ce7dea18bbf5746eb9b4c2876971",
      updatePolicy: "capability-package",
      updateManager: "desktop-capability",
      independentUpdateState: "not-applicable",
      skills: bundledSkills.slice(3, 4)
    }, {
      id: "browser67",
      displayName: "browser67",
      description: "真实浏览器操作、诊断和 JavaScript 逆向能力。",
      versionSource: "capability-package",
      bundledVersion: "0.8.0",
      upstream: "https://github.com/bigKING67/browser67",
      sourceCommit: "c9d45ae020ca502390b4b4838d924ace0d8e60d7",
      updatePolicy: "capability-package",
      updateManager: "desktop-capability",
      independentUpdateState: "not-applicable",
      skills: bundledSkills.slice(4, 6)
    }, {
      id: "design-output-tools",
      displayName: "设计与输出工具",
      description: "产品设计、视觉方向和完整输出能力。",
      versionSource: "multiple-sources",
      updatePolicy: "source-specific",
      updateManager: "source-specific",
      independentUpdateState: "not-applicable",
      skills: bundledSkills.slice(6, 8)
    }],
    recommendedExternal: [{
      id: "pi-rewind",
      source: "https://github.com/arpagon/pi-rewind.git",
      minimumCommit: "91611ad87992fb7b635a41ba68f67916ff6e6ae3",
      installPolicy: "user-initiated",
      admissionPolicy: "user-approval"
    }],
    managedContext: { rules: "installed", agents: "user-owned" },
    integrations: [{
      id: "browser67",
      displayName: "browser67",
      bundled: true,
      dependencyState: "not-prepared",
      extensionState: "not-prepared",
      doctorState: "not-checked",
      verificationState: "never",
      availableBrowsers: ["chrome", "edge"]
    }]
  };
}
