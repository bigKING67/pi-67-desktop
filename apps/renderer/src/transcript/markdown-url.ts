// Link and image components classify the untouched source before creating any URL-bearing DOM node.
export function preserveMarkdownUrlForPolicy(url: string): string {
  return url;
}
