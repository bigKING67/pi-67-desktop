export type MarkdownLinkTarget =
  | { kind: "external"; href: string }
  | { kind: "workspace"; relativePath: string; fragment?: string }
  | { kind: "unsupported" };

export function classifyMarkdownLink(href: string | undefined): MarkdownLinkTarget {
  if (!href) return { kind: "unsupported" };
  try {
    const external = new URL(href);
    return external.protocol === "https:" || external.protocol === "http:"
      ? { kind: "external", href: external.href }
      : { kind: "unsupported" };
  } catch {
    return workspaceLink(href);
  }
}

function workspaceLink(href: string): MarkdownLinkTarget {
  const hashIndex = href.indexOf("#");
  const encodedPath = hashIndex < 0 ? href : href.slice(0, hashIndex);
  const encodedFragment = hashIndex < 0 ? "" : href.slice(hashIndex + 1);
  let decodedPath: string;
  let fragment: string;
  try {
    decodedPath = decodeURIComponent(encodedPath).replaceAll("\\", "/");
    fragment = decodeURIComponent(encodedFragment);
  } catch {
    return { kind: "unsupported" };
  }

  if (!decodedPath || decodedPath.startsWith("/") || /^[A-Za-z]:\//u.test(decodedPath)) {
    return { kind: "unsupported" };
  }
  if (/^[A-Za-z][A-Za-z\d+.-]*:/u.test(decodedPath)) return { kind: "unsupported" };

  const segments = decodedPath.split("/").filter((segment) => segment !== "" && segment !== ".");
  if (segments.length === 0 || segments.some((segment) => segment === "..")) return { kind: "unsupported" };
  const relativePath = segments.join("/");
  return {
    kind: "workspace",
    relativePath,
    ...(fragment ? { fragment } : {})
  };
}
