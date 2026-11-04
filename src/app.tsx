import { lazy, Suspense } from "react";
import { Routes, Route } from "react-router-dom";
import { Layout } from "@/components/Layout";
import NotFoundPage from "@/pages/NotFoundPage/NotFoundPage";

const ProjectManagerPage = lazy(() => import("@/pages/ProjectManagerPage/ProjectManagerPage"));
const AudioEditorPage = lazy(() => import("@/pages/AudioEditorPage/AudioEditorPage"));
const SettingsPage = lazy(() => import("@/pages/SettingsPage/SettingsPage"));

export default function App() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">正在加载工作区…</div>}>
      <Routes>
        {/* Full-screen editor - no Layout chrome */}
        <Route path="/editor/:projectId" element={<AudioEditorPage />} />

        {/* Pages with Header/Footer Layout */}
        <Route element={<Layout />}>
          <Route index element={<ProjectManagerPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>

        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  );
}
