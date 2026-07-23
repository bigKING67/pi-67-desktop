import { ShieldAlert, ShieldCheck } from "lucide-react";
import { Button } from "react-aria-components";
import { useAppStore } from "../app/app-store.js";

export function TrustBanner() {
  const trust = useAppStore((state) => state.trust);
  const setTrust = useAppStore((state) => state.setTrust);
  if (trust === "trusted") return null;

  return (
    <div className="trust-banner" role="status">
      <ShieldAlert size={17} />
      <div>
        <strong>工作区尚未信任</strong>
        <span>项目级 Extensions、Skills、AGENTS.md 和写入工具保持禁用。</span>
      </div>
      <Button className="secondary-button" onPress={() => void setTrust("trusted")}>
        <ShieldCheck size={15} /> 信任并加载资源
      </Button>
    </div>
  );
}
