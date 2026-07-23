import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App.js";
import { initializeThemeController } from "./theme/theme-controller.js";
import "./styles/tokens.css";
import "./styles/global.css";
import "./styles/dialogs.css";
import "./theme/theme.css";

const root = document.getElementById("root");
if (!root) throw new Error("Pi-67 renderer root was not found.");

initializeThemeController();

void window.pi67.system.getPlatformInfo().then((info) => {
  document.documentElement.dataset.platform = info.platform;
});

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
);
