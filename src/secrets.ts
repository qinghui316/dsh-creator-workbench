import { IMAGE_CREDENTIAL } from "./covers/types.ts";
import { ASR_CREDENTIAL } from "./production/types.ts";
import type { CreatorSecrets, SecretKind, SecretView } from "./types.ts";

export const SUBTITLE_KEY_REFS = [ASR_CREDENTIAL] as const;
export const COVER_KEY_REFS = [IMAGE_CREDENTIAL] as const;

export function refsFor(kind: SecretKind): readonly string[] {
  return kind === "subtitle" ? SUBTITLE_KEY_REFS : COVER_KEY_REFS;
}

export function primaryRef(kind: SecretKind): string {
  return refsFor(kind)[0] ?? ASR_CREDENTIAL;
}

export function emptySecretView(kind: SecretKind): SecretView {
  return { kind, ref: primaryRef(kind), configured: false, writable: true };
}

export function emptySecrets(): CreatorSecrets {
  return {
    subtitle: emptySecretView("subtitle"),
    cover: emptySecretView("cover"),
  };
}

export interface DescribedCredential {
  configured?: boolean;
  writable?: boolean;
  source?: string;
}

export function viewFromDescribe(
  kind: SecretKind,
  credentials: Record<string, DescribedCredential | undefined>,
): SecretView {
  for (const ref of refsFor(kind)) {
    const row = credentials[ref];
    if (row?.configured !== true) continue;
    return {
      kind,
      ref,
      configured: true,
      writable: row.writable !== false,
      ...(typeof row.source === "string" && row.source !== "" ? { source: row.source } : {}),
    };
  }
  const primary = primaryRef(kind);
  const row = credentials[primary];
  return {
    kind,
    ref: primary,
    configured: false,
    writable: row?.writable !== false,
  };
}

export function missingSecretMessage(kind: SecretKind): string {
  return kind === "subtitle"
    ? "先到工作台设置 → 语音转文字填写火山语音 API Key"
    : "先到工作台的数据与设置填写生图服务 API Key";
}
