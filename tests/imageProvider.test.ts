import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ImageRequestError, checkImageConnection, normalizeImageSettings, readImageSettings, requestImage, safeImageError, saveImageSettings } from "../src/covers/provider.ts";

const servers: Server[] = [];
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(20)]);
async function server(handler: (req: IncomingMessage, res: ServerResponse) => void) {
  const instance = createServer(handler); servers.push(instance);
  await new Promise<void>((resolve) => instance.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(instance.address() as { port: number }).port}`;
}
afterEach(async () => { await Promise.all(servers.splice(0).map((s) => new Promise<void>((resolve) => { s.closeAllConnections(); s.close(() => resolve()); }))); });
const request = { ratio: "3x4" as const, prompt: "A real cover", mode: "text" as const, references: [] };
describe("generic image service transport", () => {
  it("normalizes a configured API root without inventing v1 or accepting embedded credentials", () => {
    expect(normalizeImageSettings({ apiBase: "https://example.test/api/v1/", model: " arbitrary/model " })).toEqual({ apiBase: "https://example.test/api/v1", model: "arbitrary/model" });
    for (const apiBase of ["file:///tmp", "https://key@host.test", "https://host.test?key=secret"]) expect(() => normalizeImageSettings({ apiBase, model: "m" })).toThrow();
  });
  it("posts standard generations JSON and accepts base64 images", async () => {
    let path = "", body = "", auth = "";
    const apiBase = await server((req, res) => { path = req.url!; auth = req.headers.authorization!; req.on("data", (b) => body += b); req.on("end", () => res.end(JSON.stringify({ data: [{ b64_json: png.toString("base64") }] }))); });
    expect(Buffer.from(await requestImage({ apiBase, model: "user-model", revision: "1" }, "test-private-key", request, new AbortController().signal))).toEqual(png);
    expect(path).toBe("/images/generations"); expect(auth).toBe("Bearer test-private-key"); expect(JSON.parse(body)).toMatchObject({ model: "user-model", size: "960x1280", n: 1 }); expect(body).not.toContain("test-private-key");
  });
  it("sends references as multipart with no explicit content-type boundary override", async () => {
    let path = "", body = "", contentType = "";
    const apiBase = await server((req, res) => { path = req.url!; contentType = req.headers["content-type"]!; req.on("data", (b) => body += b); req.on("end", () => res.end(JSON.stringify({ data: [{ b64_json: png.toString("base64") }] }))); });
    await requestImage({ apiBase, model: "m", revision: "1" }, "test-key", { ...request, mode: "reference", references: [{ data: png, name: "frame.png" }] }, new AbortController().signal);
    expect(path).toBe("/images/edits"); expect(contentType).toContain("multipart/form-data; boundary="); expect(body).toContain('name="image[]"'); expect(body).toContain('filename="frame.png"');
  });
  it("never forwards the API credential to generated image URLs or redirects", async () => {
    let downloadedAuth: string | undefined;
    const download = await server((req, res) => { downloadedAuth = req.headers.authorization; res.end(png); });
    const apiBase = await server((_req, res) => res.end(JSON.stringify({ data: [{ url: download + "/signed-image" }] })));
    await requestImage({ apiBase, model: "m", revision: "1" }, "test-secret", request, new AbortController().signal); expect(downloadedAuth).toBeUndefined();
  });
  it("does not follow an authenticated API redirect", async () => {
    let reached = false; const target = await server((_req, res) => { reached = true; res.end(png); });
    const apiBase = await server((_req, res) => { res.writeHead(302, { location: target }); res.end(); });
    await expect(requestImage({ apiBase, model: "m", revision: "1" }, "test-secret", request, new AbortController().signal)).rejects.toMatchObject({ uncertain: true }); expect(reached).toBe(false);
  });
  it("treats an explicit 401 as failed and a lost response as unconfirmed, without automatic retry", async () => {
    let calls = 0; const apiBase = await server((req, res) => { calls++; if (calls === 1) { res.writeHead(401); res.end("private response"); } else req.socket.destroy(); });
    await expect(requestImage({ apiBase, model: "m", revision: "1" }, "key", request, new AbortController().signal)).rejects.toMatchObject({ uncertain: false });
    await expect(requestImage({ apiBase, model: "m", revision: "1" }, "key", request, new AbortController().signal)).rejects.toBeInstanceOf(ImageRequestError); expect(calls).toBe(2);
  });
  it("rejects non-image output and redacts credential-shaped errors", async () => {
    const apiBase = await server((_req, res) => res.end(JSON.stringify({ data: [{ b64_json: Buffer.from("<html>not an image</html>").toString("base64") }] })));
    await expect(requestImage({ apiBase, model: "m", revision: "1" }, "secret-value", request, new AbortController().signal)).rejects.toMatchObject({ uncertain: true });
    expect(safeImageError(new Error("secret-value Bearer other-secret sk-long-secret"), "secret-value")).not.toMatch(/secret-value|other-secret|sk-long/);
  });
  it("keeps configuration credential-free, invalidates previous checks and does not claim image support from GET models", async () => {
    const dir = await mkdtemp(join(tmpdir(), "creator-image-settings-")); const apiBase = await server((_req, res) => res.end('{"data":[]}'));
    const settings = await saveImageSettings(dir, { apiBase, model: "m" }); const checked = await checkImageConnection(settings, "key", new AbortController().signal);
    expect(checked.checked?.generation).toBe("未验证"); expect(checked.checked?.edit).toBe("未验证");
    const next = await saveImageSettings(dir, settings); expect(next.revision).not.toBe(settings.revision); expect((await readImageSettings(dir)).checked).toBeUndefined(); expect(JSON.stringify(next)).not.toContain('"key"');
  });
});
