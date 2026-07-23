import {
  ALLOWED_IMAGE_MIME_TYPES,
  MAX_TRANSFER_IMAGE_BYTES,
  MAX_TRANSFER_IMAGE_COUNT,
  MAX_TRANSFER_IMAGE_TOTAL_BYTES,
  type TransferImage
} from "@pi67/protocol";
import { ArrowUp, ImagePlus, ListPlus, Send, Square } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "react-aria-components";
import { useAppStore } from "../app/app-store.js";

export function Composer() {
  const snapshot = useAppStore((state) => state.snapshot);
  const widgets = useAppStore((state) => state.extensionWidgets);
  const sendMessage = useAppStore((state) => state.send);
  const abort = useAppStore((state) => state.abort);
  const [text, setText] = useState("");
  const [images, setImages] = useState<TransferImage[]>([]);
  const [attachmentError, setAttachmentError] = useState<string>();
  const [streamBehavior, setStreamBehavior] = useState<"steer" | "followUp">("followUp");
  const fileInput = useRef<HTMLInputElement>(null);
  const streaming = snapshot?.streaming ?? false;
  const canSend = text.trim().length > 0 || images.length > 0;

  const submit = async () => {
    if (!canSend) return;
    const nextText = text.trim();
    const nextImages = images;
    setText("");
    setImages([]);
    await sendMessage(nextText, nextImages, streaming ? streamBehavior : "send");
  };

  return (
    <footer className="composer-region">
      {Object.entries(widgets).filter(([, value]) => value).map(([key, value]) => (
        <div className="extension-widget" key={key}><strong>{key}</strong><span>{value}</span></div>
      ))}
      {snapshot && (snapshot.steeringQueue.length > 0 || snapshot.followUpQueue.length > 0) ? (
        <div className="queue-summary">
          <ListPlus size={14} />
          {snapshot.steeringQueue.length} 条 steer · {snapshot.followUpQueue.length} 条 follow-up
        </div>
      ) : null}
      <div className="composer-shell">
        {attachmentError ? <div className="attachment-error" role="alert">{attachmentError}</div> : null}
        {images.length > 0 ? (
          <div className="attachment-row">
            {images.map((image, index) => (
              <button key={`${image.name}-${index}`} type="button" onClick={() => setImages((items) => items.filter((_, itemIndex) => itemIndex !== index))}>
                {image.name}<span aria-hidden="true">×</span>
              </button>
            ))}
          </div>
        ) : null}
        <textarea
          aria-label="给 Pi 发送消息"
          value={text}
          placeholder={streaming ? "补充方向，或排入 follow-up..." : "描述目标、相关文件和验收标准..."}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void submit();
            }
          }}
        />
        <div className="composer-toolbar">
          <div className="composer-tools">
            <input
              ref={fileInput}
              className="sr-only"
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              multiple
              onChange={(event) => {
                const input = event.currentTarget;
                const files = input.files;
                setAttachmentError(undefined);
                void readImages(files, images).then(setImages).catch((error: unknown) => {
                  setAttachmentError(error instanceof Error ? error.message : "无法读取所选图片。");
                }).finally(() => {
                  input.value = "";
                });
              }}
            />
            <Button className="icon-button" aria-label="添加图片" onPress={() => fileInput.current?.click()}><ImagePlus size={16} /></Button>
            {streaming ? (
              <div className="stream-mode" aria-label="Streaming message behavior">
                <button className={streamBehavior === "steer" ? "is-active" : ""} type="button" onClick={() => setStreamBehavior("steer")}><ArrowUp size={13} />Steer</button>
                <button className={streamBehavior === "followUp" ? "is-active" : ""} type="button" onClick={() => setStreamBehavior("followUp")}><ListPlus size={13} />Follow-up</button>
              </div>
            ) : <span className="composer-hint">Enter 发送 · Shift+Enter 换行</span>}
          </div>
          <div className="composer-actions">
            {streaming ? <Button className="stop-button" onPress={() => void abort()}><Square size={13} />停止</Button> : null}
            <Button className="send-button" isDisabled={!canSend} onPress={() => void submit()}>
              <Send size={15} />{streaming ? "加入" : "发送"}
            </Button>
          </div>
        </div>
      </div>
    </footer>
  );
}

async function readImages(files: FileList | null, current: TransferImage[]): Promise<TransferImage[]> {
  if (!files) return current;
  const selected = Array.from(files);
  if (current.length + selected.length > MAX_TRANSFER_IMAGE_COUNT) {
    throw new Error(`每条消息最多添加 ${MAX_TRANSFER_IMAGE_COUNT} 张图片。`);
  }
  let totalBytes = current.reduce((sum, image) => sum + image.data.byteLength, 0);
  for (const file of selected) {
    if (!ALLOWED_IMAGE_MIME_TYPES.some((mimeType) => mimeType === file.type)) throw new Error(`不支持 ${file.name} 的图片格式。`);
    if (file.size > MAX_TRANSFER_IMAGE_BYTES) throw new Error(`${file.name} 超过单张 10 MiB 限制。`);
    totalBytes += file.size;
    if (totalBytes > MAX_TRANSFER_IMAGE_TOTAL_BYTES) throw new Error("图片总大小超过每条消息 30 MiB 限制。");
  }
  const next = await Promise.all(selected.map(async (file) => ({
    name: file.name,
    mimeType: file.type,
    data: await file.arrayBuffer()
  })));
  return [...current, ...next];
}
