import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";
import "./styles-customers.css";
import "./styles-settings.css";
import "./styles-manage.css";
import "./styles-suppliers.css";
import "./styles-team.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
