export function AttachmentPreviewLoading() {
  return (
    <div
      aria-busy="true"
      aria-label="正在加载附件预览"
      role="status"
      style={{ display: "grid", width: 218, height: 56, flex: "0 0 auto", placeItems: "center" }}
    >
      <span className="loading-line" />
    </div>
  );
}
