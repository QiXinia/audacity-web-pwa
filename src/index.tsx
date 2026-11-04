import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { ErrorBoundary } from "react-error-boundary";
import { registerSW } from "virtual:pwa-register";
import { toast } from "sonner";
import App from "./app";
import { logger } from "@/lib/logger";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter basename={import.meta.env.BASE_URL || "/"}>
      <ErrorBoundary
        fallbackRender={({ error, resetErrorBoundary }) => (
          <main className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
            <section className="w-full max-w-md rounded-lg border border-border bg-card p-6 text-center">
              <h1 className="text-lg font-semibold">应用遇到错误</h1>
              <p className="mt-2 break-words text-sm text-muted-foreground">
                {error instanceof Error ? error.message : String(error)}
              </p>
              <button
                type="button"
                className="mt-5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
                onClick={resetErrorBoundary}
              >
                重试
              </button>
            </section>
          </main>
        )}
      >
        <App />
      </ErrorBoundary>
    </BrowserRouter>
  </StrictMode>,
);

// PWA: 注册 Service Worker，有新版本时提示用户刷新
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      toast("有新版本可用", {
        description: "点击刷新以更新到最新版本",
        action: {
          label: "刷新",
          onClick: () => {
            updateSW(true);
          },
        },
        duration: Infinity,
      });
    },
    onRegisteredSW(url, registration) {
      logger.info("PWA Service Worker 注册成功:", url);
      if (registration) {
        setInterval(() => {
          registration.update().catch((e) => {
            logger.error("SW 更新检查失败:", String(e));
          });
        }, 60 * 60 * 1000);
      }
    },
    onRegisterError(error) {
      logger.error("PWA Service Worker 注册失败:", String(error));
    },
    onOfflineReady() {
      logger.info("PWA 离线就绪");
    },
  });
}
