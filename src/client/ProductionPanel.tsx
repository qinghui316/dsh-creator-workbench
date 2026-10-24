import type { ComponentProps } from "react";
import { LegacyPublishingPanel } from "./LegacyPublishingPanel.tsx";
import { SubtitlePanel } from "./SubtitlePanel.tsx";
import { ArticlePanel } from "./ArticlePanel.tsx";
export function ProductionPanel({ mode, ...props }: ComponentProps<typeof LegacyPublishingPanel> & { mode: "publishing" | "subtitle" | "article" }) {
  return mode === "publishing" ? <LegacyPublishingPanel {...props} /> : mode === "subtitle" ? <SubtitlePanel {...props} /> : <ArticlePanel {...props} goPublish={() => undefined} />;
}
