import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App.js";
import "./styles/tokens.css";
import "./styles/global.css";
import "./styles/dialogs.css";

const root = document.getElementById("root");
if (!root) throw new Error("Pi-67 renderer root was not found.");

void window.pi67.system.getPlatformInfo().then((info) => {
  document.documentElement.dataset.platform = info.platform;
});

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
);
