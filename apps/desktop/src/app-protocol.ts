import { pathToFileURL } from "node:url";
import { net, protocol } from "electron";
import { resolveApplicationAssetFilePath } from "./app-protocol-path.js";
import { isImagePreviewUrl, readImagePreview, type TrustedWorkspaceRoot } from "./app-protocol-image.js";

export function registerAppSchemePrivileges(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: "app",
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: false,
        stream: true
      }
    }
  ]);
}

export function registerApplicationProtocol(rendererDirectory: string, imageWorkspaceRoot?: TrustedWorkspaceRoot): void {
  protocol.handle("app", async (request) => {
    if (isImagePreviewUrl(request.url)) {
      return imageWorkspaceRoot ? readImagePreview(request.url, imageWorkspaceRoot) : new Response("Not found", { status: 404 });
    }
    const filePath = await resolveApplicationAssetFilePath(rendererDirectory, request.url);
    if (!filePath) return new Response("Not found", { status: 404 });
    return net.fetch(pathToFileURL(filePath).toString());
  });
}
