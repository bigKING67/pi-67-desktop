/** Pi Extension: the New Money image workbench tools and the `openai-images` image API (ADR 0010).
 * The image engine owns projects; Pi owns the model route and credentials.
 */
import { IMAGE_PROVIDER_ID } from "@pi67/domain";
import type { ExtensionAPI } from "@pi67/pi-runtime/pi-sdk-types";
import { imageProviderBaseUrl, imageProviderRegistration, piAgentDirectory } from "./image-provider.js";
import { imageTools } from "./tools.js";

export default function initializeImageWorkbench(pi: ExtensionAPI, agentDirectory: string = piAgentDirectory()): void {
  for (const tool of imageTools()) pi.registerTool(tool);
  // Without a configured image Provider the editing tools still work; generation
  // reports that no Pi image model is configured and never sends a request.
  const baseUrl = imageProviderBaseUrl(agentDirectory);
  if (baseUrl) pi.registerProvider(IMAGE_PROVIDER_ID, imageProviderRegistration(baseUrl));
}
