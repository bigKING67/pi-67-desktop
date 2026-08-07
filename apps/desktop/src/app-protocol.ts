import { pathToFileURL } from "node:url";
import { net, protocol } from "electron";
import { resolveApplicationAssetFilePath } from "./app-protocol-path.js";

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

export function registerApplicationProtocol(rendererDirectory: string): void {
  protocol.handle("app", async (request) => {
    const filePath = await resolveApplicationAssetFilePath(rendererDirectory, request.url);
    if (!filePath) return new Response("Not found", { status: 404 });
    return net.fetch(pathToFileURL(filePath).toString());
  });
}
