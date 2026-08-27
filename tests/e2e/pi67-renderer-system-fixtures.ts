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
    packageId: "pi67-core",
    packageDisplayName: "Pi-67 Core",
    version: "0.15.8",
    installed: true
  }, {
    id: "lark-calendar",
    displayName: "lark-calendar",
    description: "管理飞书日历、日程、忙闲状态和会议室。",
    packageId: "pi67-core",
    packageDisplayName: "Pi-67 Core",
    version: "0.15.8",
    installed: true
  }, {
    id: "investment-research",
    displayName: "investment-research",
    description: "投资研究综合分析框架。",
    packageId: "pi67-core",
    packageDisplayName: "Pi-67 Core",
    version: "0.15.8",
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
    version: "0.5.0",
    installed: true
  }, {
    id: "js-reverse",
    displayName: "js-reverse",
    description: "浏览器 JavaScript 逆向和证据化分析。",
    packageId: "browser67",
    packageDisplayName: "browser67",
    version: "0.5.0",
    installed: true
  }, {
    id: "design-craft",
    displayName: "design-craft",
    description: "产品界面和交互设计工程能力。",
    packageId: "design-craft",
    packageDisplayName: "design-craft",
    version: "0.5.6",
    installed: true
  }, {
    id: "minimalist-ui",
    displayName: "minimalist-ui",
    description: "简洁的编辑式界面设计方向。",
    packageId: "pi67-core",
    packageDisplayName: "Pi-67 Core",
    version: "0.15.8",
    installed: true
  }];
  return {
    phase: "ready",
    catalogVersion: "2026.08.27.2",
    packages: [{
      id: "pi67-core",
      displayName: "Pi-67 Core",
      origin: "first-party",
      bundled: true,
      defaultEnabled: true,
      version: "0.15.8",
      commit: "500f3f63a14d80b0297a1dcc04237b5e2cf87894",
      resourceTypes: ["extension", "skill", "prompt", "rule"],
      installed: true
    }, {
      id: "browser67",
      displayName: "browser67",
      origin: "first-party",
      bundled: true,
      defaultEnabled: true,
      version: "0.5.0",
      commit: "aa8ca485fc27a5282e7215c0bcd3f355585231b0",
      resourceTypes: ["skill", "integration"],
      installed: true
    }, {
      id: "design-craft",
      displayName: "design-craft",
      origin: "first-party",
      bundled: true,
      defaultEnabled: true,
      version: "0.5.6",
      commit: "9a90f15ea9e4dd6104cbd2ba2976e8603fee396e",
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
    bundledExtensions: [
      "pi-rules-loader"
    ].map((id) => ({
      id,
      displayName: id,
      packageId: "pi67-core",
      packageDisplayName: "Pi-67 Core",
      version: "0.15.8",
      installed: true
    })),
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
      bundledVersion: "1.0.6",
      upstream: "https://github.com/xbtlin/ai-berkshire",
      sourceCommit: "e83c25444989a045ce59da0ba6142cd03d62f580",
      updatePolicy: "hybrid",
      updateManager: "pi67-skill-pack-registry",
      independentUpdateState: "available",
      skills: bundledSkills.slice(2, 3)
    }, {
      id: "commerce-growth-os",
      displayName: "Commerce Growth OS",
      description: "电商经营、品牌、内容、增长和经营分析能力。",
      versionSource: "capability-package",
      bundledVersion: "2.2.0",
      upstream: "https://github.com/bigKING67/commerce-growth-os",
      sourceCommit: "1c28f48ef002ce7dea18bbf5746eb9b4c2876971",
      updatePolicy: "hybrid",
      updateManager: "pi67-skill-pack-registry",
      independentUpdateState: "planned",
      skills: bundledSkills.slice(3, 4)
    }, {
      id: "browser67",
      displayName: "browser67",
      description: "真实浏览器操作、诊断和 JavaScript 逆向能力。",
      versionSource: "capability-package",
      bundledVersion: "0.5.0",
      upstream: "https://github.com/bigKING67/browser67",
      sourceCommit: "aa8ca485fc27a5282e7215c0bcd3f355585231b0",
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
