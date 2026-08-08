# Team Tavily Bridge MCP

Desktop 内置团队搜索中转（Tavily Bridge）的 **server 定义**。
**Client Token 不随安装包分发**，由每位用户在 Settings → 集成 中自行配置。

## 两条链路（不要混）

| 能力 | 实现 | 凭据 |
| --- | --- | --- |
| `web_search` / `source_check` / `fetch_content` / `get_search_content` | Pi-67 第一方 Pi SDK Tools | 所选模型的 Pi Provider Credential；无已声明原生路由时显式失败，不切换 Provider |
| `tavily_bridge_tavily_search` 等 | `pi-mcp-adapter` + 本 server | 自建中转 `mcp_<prefix>.<secret>` Client Token |

Pi-67 Search 不经过本 Team Tavily Bridge，也不需要安装 `pi-web-access`。
把 `mcp_…` Token 填进任意 Provider 或 Search Credential **不会**走中转服务；它只用于
显式的 `tavily_bridge_*` MCP Tools。

## 文件

| 文件 | 是否进 Git | 用途 |
| --- | --- | --- |
| `tavily-bridge.server.json` | 是 | MCP server 定义（无密钥） |
| `tavily-bridge.token` | 否（且不再用于发版） | 历史遗留；请勿提交 |

## 用户配置位置

Token 保存在 Electron `userData/team-mcp/tavily-bridge.token`（权限 600）。
Main 在启动 Agent Host 时注入 `TAVILY_BRIDGE_MCP_TOKEN`；保存/清除后会重启 Host。

开发态若尚未在 Settings 配置，可回退读取本机 `~/.grok/secrets/tavily_bridge_mcp_token`（仅非 packaged）。

## 打包

安装包只打包 `tavily-bridge.server.json` 与本 README。
`prepare:team-mcp` 仅用于本地可选校验，**不会把密钥打进 Git 或作为发布必需步骤**。
