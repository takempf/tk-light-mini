import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./fonts.css";
import "tk-design-system/source/styles.css";
import App from "./App";

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
