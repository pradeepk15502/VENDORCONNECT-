import { createApiClient, SessionProvider } from "@vc/api-client";
import { I18nProvider } from "@vc/i18n";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import "./admin.css";

const api = createApiClient();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <I18nProvider initial="en">
      <SessionProvider api={api}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </SessionProvider>
    </I18nProvider>
  </StrictMode>,
);
