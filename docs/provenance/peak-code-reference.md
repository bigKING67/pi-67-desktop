# Peak Code reference provenance

参考仓库：`PeakCode-AI/PeakCode`

固定参考 commit：

```text
5aee9cfcbb29283f9320a132693d4a250033fb9e
```

采用的是产品层观察：workspace/session navigation、transcript/composer/context 三区域、
工具状态和桌面生命周期。Pi-67 Desktop 在此基础上做 Pi-first 收敛和更严格的进程边界。

明确不采用：

- 多 Provider/Adapter 导航和 Codex app-server 专属层；
- localhost backend、业务 WebSocket 和 renderer token；
- Peak Code 品牌、图标、字体、截图或二进制资产；
- 上游目录结构、巨型组件或源码自动 merge；
- 默认 telemetry/gateway provisioning。

当前没有复制 Peak Code 源码。如果未来有选择性移植，必须在同一变更中记录源文件、
源 commit、修改范围和 MIT copyright/license。
