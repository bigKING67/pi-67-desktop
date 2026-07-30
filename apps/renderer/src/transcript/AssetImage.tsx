import type { AssetReference } from "@pi67/domain";
import { RotateCw } from "lucide-react";
import { useEffect, useState } from "react";
import { conversationAssetController } from "../conversation/conversation-asset-controller.js";
import styles from "./AssetImage.module.css";

interface AssetImageProps {
  asset?: AssetReference | undefined;
  mimeType: string;
  name: string | undefined;
  objectUrl?: string;
}

type AssetImageState =
  | { status: "loading" }
  | { status: "ready"; objectUrl: string }
  | { status: "error" };

export function AssetImage({ asset, mimeType, name, objectUrl }: AssetImageProps) {
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<AssetImageState>({ status: "loading" });

  useEffect(() => {
    if (objectUrl) return;
    if (!asset) return;
    let active = true;
    setState({ status: "loading" });
    const lease = conversationAssetController.acquire(asset);
    void lease.value.then(({ objectUrl }) => {
      if (active) setState({ status: "ready", objectUrl });
    }).catch(() => {
      if (active) setState({ status: "error" });
    });
    return () => {
      active = false;
      lease.release();
    };
  }, [asset, objectUrl, retry]);

  if (objectUrl) return <ProjectedImage name={name} objectUrl={objectUrl} />;
  if (!asset) {
    return (
      <div className={styles.imagePlaceholder} role="status">
        图片不可用：该格式或大小未进入桌面投影。
      </div>
    );
  }
  if (state.status === "ready") {
    return <ProjectedImage name={name} objectUrl={state.objectUrl} />;
  }
  if (state.status === "error") {
    return (
      <div className={`${styles.imagePlaceholder} ${styles.imageError}`} role="alert">
        <span>图片未能从 Pi 运行服务加载。</span>
        <button className={styles.imageRetry} onClick={() => setRetry((value) => value + 1)} type="button">
          <RotateCw aria-hidden="true" size={13} />
          重试
        </button>
      </div>
    );
  }
  return (
    <div aria-label={`正在加载${name ?? mimeType}图片`} className={styles.imagePlaceholder} role="status">
      图片加载中
    </div>
  );
}

function ProjectedImage({ name, objectUrl }: { name: string | undefined; objectUrl: string }) {
  return (
    <img
      alt={name ?? "会话图片"}
      className={styles.image}
      decoding="async"
      loading="lazy"
      src={objectUrl}
    />
  );
}
