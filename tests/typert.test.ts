import { describe, expect, it } from "vitest";

import { CREATOR_WORKBENCH_INVOCATIONS, PACKAGE_NAME, REMOTE_NAMESPACE } from "../src/remote-contract.ts";
import { TYPERT } from "../src/typert.host.ts";

describe("handwritten TYPERT", () => {
  it("matches the package and host face", () => {
    expect(TYPERT.package).toBe(PACKAGE_NAME);
    expect(TYPERT.face).toBe("host");
    expect(TYPERT.invocations).toBe(CREATOR_WORKBENCH_INVOCATIONS);
  });

  it("exposes creatorWorkbench methods with zod v4 codecs", () => {
    const methods = CREATOR_WORKBENCH_INVOCATIONS.map((item) => item.method);
    expect(methods).toEqual([
      "setVideoVisibility",
      "getCoverState",
      "coverAction",
      "getCoverImage",
      "getImageSettings",
      "setImageSettings",
      "beginImageUpdate",
      "completeImageUpdate",
      "checkImageService",
      "selectVideo",
      "startVideoImport",
      "getVideoImport",
      "cancelVideoImport",
      "listContents",
      "getContent",
      "getCoverThumb",
      "getVideoPlayback",
      "getArticleMedia",
      "getSubtitleText",
      "openContentPath",
      "getSettings",
      "getCapabilities",
      "getRevision",
      "setLibraryRoot",
      "refreshCatalog",
      "createContent",
      "setProfile",
      "setScriptRules",
      "setPublish",
      "syncPublish",
      "setScript",
      "openSubtitlePreview",
      "startSubtitleBurn",
      "startSubtitleGenerate",
      "startCoverGenerate",
    ]);
    for (const item of CREATOR_WORKBENCH_INVOCATIONS) {
      expect(item.service).toBe(REMOTE_NAMESPACE);
      expect(item.namespace).toBe(REMOTE_NAMESPACE);
      expect(item.result.mode).toBe("strict");
      if (item.result.mode !== "strict") continue;
      expect("_zod" in item.result.create()).toBe(true);
      expect(typeof item.result.create().parse).toBe("function");
    }
  });
});
