import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../../../src/fonts.css";
import "tk-design-system/source/styles.css";
import AdminApp from "../../../src/AdminApp";
import "./style.css";

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <AdminApp />
  </StrictMode>,
);
