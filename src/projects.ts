import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir, realpath, rename, stat, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, normalize } from "node:path";
import { z } from "zod";
import { decodeOverlay } from "./overlay.ts";
import { readCoverState } from "./covers/files.ts";
import { readState } from "./production/storage.ts";
import type { OverlayItem, OverlayStore } from "./types.ts";
import { datedProjectName, projectTitle } from "./projectNames.ts";
import { boundedRead } from "./fsReadDeadline.ts";

const projectSchema = z.object({
  id: z.string().min(1), path: z.string().min(1), sourcePath: z.string().min(1), key: z.string().min(1),
  revision: z.string().min(1), name: z.string(), parent: z.string(), aliases: z.array(z.string()),
  pathAliases: z.array(z.string()).default([]),
  addedAt: z.number(), removed: z.boolean(),
  item: z.record(z.string(), z.unknown()), selectedVideo: z.string().nullable().optional(), hiddenVideos: z.array(z.string()),
});
const locationSchema = z.object({ path: z.string().min(1), key: z.string().min(1), sourcePath: z.string().min(1), pathAliases: z.array(z.string()).default([]) });
const registrySchema = z.object({ schemaVersion: z.literal(1), revision: z.number().int(),
  defaultParent: z.string().optional(), locations: z.array(locationSchema), projects: z.array(projectSchema),
  legacyItems: z.record(z.string(), z.unknown()).default({}),
});
type StoredProject = z.infer<typeof projectSchema>;
export type ProjectRecord = Omit<StoredProject, "item"> & { item: OverlayItem };
export type ProjectLocation = z.infer<typeof locationSchema>;
export interface ProjectsState extends Omit<z.infer<typeof registrySchema>, "projects"> { projects: ProjectRecord[] }

export function directoryKey(path: string): string {
  const value = normalize(path).replace(/[\\/]+$/, "") || normalize(path);
  return process.platform === "win32" ? value.toLowerCase() : value;
}
const identity = () => `project-${randomUUID()}`;
const tails = new Map<string, Promise<unknown>>();
async function serial<T>(key: string, work: () => Promise<T>): Promise<T> {
  const result = (tails.get(key) ?? Promise.resolve()).then(work, work);
  const settled = result.then(() => undefined, () => undefined);
  tails.set(key, settled); void settled.then(() => { if (tails.get(key) === settled) tails.delete(key); });
  return result;
}
async function atomic(path: string, value: unknown): Promise<void> {
  const temp = `${path}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2) + "\n", { encoding: "utf8", flag: "wx" });
  try {
    for (let n = 0; ; n++) {
      try { await rename(temp, path); return; }
      catch (error) { if (n >= 5 || !["EPERM", "EBUSY", "EACCES"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error; await new Promise(r => setTimeout(r, 25 * (n + 1))); }
    }
  } finally { await unlink(temp).catch(() => undefined); }
}
async function directory(path: string): Promise<string> {
  if (!isAbsolute(path)) throw new Error("请选择完整的文件夹路径。");
  const actual = await boundedRead(realpath(path));
  if (!(await boundedRead(stat(actual))).isDirectory()) throw new Error("请选择文件夹。");
  await boundedRead(readdir(actual)); // Unreadable directories cannot masquerade as empty projects.
  return actual;
}
async function knownPath(path: string): Promise<string> {
  try { return await boundedRead(realpath(path)); }
  catch (error) { if (["ENOENT", "EACCES", "EPERM", "ENOTDIR", "ETIMEDOUT"].includes((error as NodeJS.ErrnoException).code ?? "")) return normalize(path); throw error; }
}
function register(state: ProjectsState, path: string, sourcePath = path): ProjectRecord {
  const key = directoryKey(path);
  const alias = state.projects.find(p => [p.sourcePath, ...p.pathAliases].some(a => directoryKey(a) === directoryKey(sourcePath)));
  if (alias && alias.key !== key) throw new Error("这个目录链接的位置已变化，请核对原项目后重新选择实际位置。");
  const existing = state.projects.find(p => p.key === key);
  if (existing) { existing.pathAliases = [...new Set([...existing.pathAliases, sourcePath])]; existing.aliases = [...new Set([...existing.aliases, basename(sourcePath)])]; return existing; }
  const project: ProjectRecord = { id: identity(), key, path, sourcePath, pathAliases: [sourcePath], revision: randomUUID(), name: basename(sourcePath), parent: dirname(path), aliases: [...new Set([basename(path), basename(sourcePath)])], addedAt: Date.now(), removed: false, item: {}, hiddenVideos: [] };
  state.projects.push(project); return project;
}
function rememberLocation(state: ProjectsState, path: string, sourcePath = path): void {
  const key = directoryKey(path);
  const alias = state.locations.find(p => [p.sourcePath, ...p.pathAliases].some(a => directoryKey(a) === directoryKey(sourcePath)));
  if (alias && alias.key !== key) throw new Error("保存位置的目录链接已变化，请选择实际位置。");
  const existing = state.locations.find(p => p.key === key);
  if (!existing) state.locations.push({ path, key, sourcePath, pathAliases: [sourcePath] });
  else existing.pathAliases = [...new Set([...existing.pathAliases, sourcePath])];
}
function decode(raw: unknown): ProjectsState {
  const value = registrySchema.parse(raw);
  if (new Set(value.projects.map(p => p.id)).size !== value.projects.length || new Set(value.projects.map(p => p.key)).size !== value.projects.length) throw new Error("项目登记包含重复身份。");
  if (value.projects.some(p => !isAbsolute(p.path) || directoryKey(p.path) !== p.key) || value.locations.some(p => !isAbsolute(p.path) || directoryKey(p.path) !== p.key)) throw new Error("项目目录记录不完整。");
  if (value.defaultParent && !value.locations.some(p => p.path === value.defaultParent)) throw new Error("默认保存位置记录不完整。");
  return { ...value, projects: value.projects.map(p => ({ ...p, item: decodeOverlay({ items: { current: p.item } }).items.current ?? {} })) } as ProjectsState;
}

/** Local registration owns identity and selection; media/body/task files stay in their project. */
export class ProjectRegistry {
  readonly file: string;
  constructor(readonly dataDir: string) { this.file = join(dataDir, "projects.json"); }

  async read(): Promise<ProjectsState | undefined> {
    try { return decode(JSON.parse(await readFile(this.file, "utf8"))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw new Error("项目记录读取失败，请保留 projects.json 并重试。", { cause: error }); }
  }
  async save(state: ProjectsState): Promise<void> {
    decode(state); await mkdir(this.dataDir, { recursive: true }); state.revision++; await atomic(this.file, state);
  }
  async update<T>(work: (state: ProjectsState) => Promise<T> | T): Promise<T> {
    return serial(this.file, async () => { const state = await this.read(); if (!state) throw new Error("项目记录尚未初始化。"); const result = await work(state); await this.save(state); return result; });
  }
  async initialize(overlay: OverlayStore, fallback: string): Promise<ProjectsState> {
    return serial(this.file, async () => {
      const existing = await this.read(); if (existing) { const before = JSON.stringify(existing); await this.discoverInto(existing); if (JSON.stringify(existing) !== before) await this.save(existing); return existing; }
      await mkdir(this.dataDir, { recursive: true });
      let originalOverlay: string | undefined;
      try {
        originalOverlay = await readFile(join(this.dataDir, "overlay.json"), "utf8");
        const raw = JSON.parse(originalOverlay);
        if (!raw || Array.isArray(raw) || typeof raw !== "object" || (raw.schemaVersion !== undefined && raw.schemaVersion !== 1) || (raw.items !== undefined && (!raw.items || Array.isArray(raw.items) || typeof raw.items !== "object"))) throw new Error("旧记录格式不受支持。");
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("旧项目记录读取失败，请保留 overlay.json 并检查后重试。", { cause: error }); }
      const roots = [...new Set([overlay.libraryRoot ?? fallback, ...Object.keys(overlay.videoSelections ?? {}), ...Object.keys(overlay.hiddenVideos ?? {}), ...Object.keys(overlay.hiddenContents ?? {})])].filter(isAbsolute);
      const state: ProjectsState = { schemaVersion: 1, revision: 0, locations: [], projects: [], legacyItems: structuredClone(overlay.items) };
      const resolvedRoots = await Promise.all(roots.map(async root => {
        try { return { root, actual: await boundedRead(realpath(root)), online: true }; }
        catch { return { root, actual: normalize(root), online: false }; }
      }));
      for (const { root, actual, online } of resolvedRoots) {
        rememberLocation(state, actual, root);
        if (overlay.libraryRoot && directoryKey(root) === directoryKey(overlay.libraryRoot)) state.defaultParent = actual;
        const ids = new Set([...Object.keys(overlay.videoSelections?.[root] ?? {}), ...Object.keys(overlay.hiddenVideos?.[root] ?? {}), ...(overlay.hiddenContents?.[root] ?? [])]);
        const paths = await Promise.all([...ids].filter(id => id && id !== "." && id !== ".." && !/[\\/]/.test(id)).map(async id => ({ id, path: online ? await knownPath(join(root, id)).catch(() => normalize(join(root, id))) : normalize(join(root, id)) })));
        for (const { id, path } of paths) {
          const p = register(state, path, join(root, id));
          p.removed ||= overlay.hiddenContents?.[root]?.includes(id) ?? false;
          const selected = overlay.videoSelections?.[root]?.[id];
          if (selected !== undefined) p.selectedVideo = p.selectedVideo !== undefined && p.selectedVideo !== selected ? null : selected;
          p.hiddenVideos = [...new Map([...p.hiddenVideos, ...(overlay.hiddenVideos?.[root]?.[id] ?? [])].map(name => [process.platform === "win32" ? name.toLowerCase() : name, name])).values()];
          // Global basename marks have no historical directory provenance. Keep them
          // in legacyItems/backup rather than attributing A/demo's status to B/demo.
        }
      }
      await writeFile(join(this.dataDir, "projects-migration-overlay.backup.json"), originalOverlay ?? JSON.stringify(overlay, null, 2), { encoding: "utf8", flag: "wx" }).catch(error => { if (error.code !== "EEXIST") throw error; });
      await this.discoverInto(state);
      await this.save(state); return state;
    });
  }
  async discoverInto(state: ProjectsState): Promise<void> {
    const discovered = await Promise.all(state.locations.map(async location => {
      const results: Array<{ path: string; source: string }> = [];
      let actual: string;
        try {
        actual = await directory(location.sourcePath); if (directoryKey(actual) !== location.key) return results;
        } catch { return results; }
      const entries = await boundedRead(readdir(actual, { withFileTypes: true })).catch(() => []);
      let index = 0;
      await Promise.all(Array.from({ length: Math.min(8, entries.length) }, async () => {
        for (;;) {
          const entry = entries[index++]; if (!entry) return;
          if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
          const source = join(actual, entry.name);
          if (state.projects.some(p => [p.path, p.sourcePath, ...p.pathAliases].some(a => directoryKey(a) === directoryKey(source)))) continue;
          try {
            // A timed-out recognition has no write path; late filesystem reads
            // can neither register a candidate nor mutate the caller's snapshot.
            const path = await boundedRead((async () => {
              const path = await realpath(source), meta = join(path, ".dsh-creator-workbench");
              const info = await lstat(meta); if (!info.isDirectory() || info.isSymbolicLink()) return;
              try { const production = join(meta, "production", "index.json"); if ((await lstat(production)).isFile()) { await readState(path); return path; } } catch { /* No production evidence. */ }
              try { const markerFile = join(meta, "project.json"), info = await lstat(markerFile); if (!info.isFile() || info.isSymbolicLink()) return; const marker = JSON.parse(await readFile(markerFile, "utf8")); if (marker.schemaVersion === 1 && typeof marker.creationId === "string" && marker.creationId) return path; } catch { /* No creation evidence. */ }
              try { const dir = await lstat(join(meta,"covers")), file = await lstat(join(meta,"covers","index.json")); if (dir.isDirectory() && !dir.isSymbolicLink() && file.isFile() && !file.isSymbolicLink()) { await readCoverState(path); return path; } } catch { /* No cover evidence. */ }
            })(), 2000);
            if (path) results.push({ path, source });
          } catch { /* Isolate a bad/offline child. */ }
        }
      }));
      return results;
    }));
    for (const { path, source } of discovered.flat()) {
      try { register(state, path, source); } catch { /* Retargeted aliases remain isolated. */ }
    }
  }
  async discover(): Promise<void> { await serial(this.file, async () => { const state = await this.read(); if (!state) throw new Error("项目记录尚未初始化。"); const before = JSON.stringify(state); await this.discoverInto(state); if (JSON.stringify(state) !== before) await this.save(state); }); }
  async setDefault(path: string): Promise<ProjectsState> {
    const actual = await directory(path);
    return this.update(async state => { rememberLocation(state, actual, path); state.defaultParent = actual; await this.discoverInto(state); return state; });
  }
  async join(path: string): Promise<ProjectRecord> {
    const actual = await directory(path);
    return this.update(state => { const p = register(state, actual, path); p.removed = false; rememberLocation(state, dirname(actual)); return p; });
  }
  async recover(path: string): Promise<ProjectRecord> {
    const actual = await knownPath(path);
    if (!isAbsolute(actual)) throw new Error("项目目录必须是完整路径。");
    return this.update(state => { const p = register(state, actual, path); rememberLocation(state, dirname(actual)); return p; });
  }
  resolve(state: ProjectsState, id: string, folder?: string, includeRemoved = false): ProjectRecord | undefined {
    let candidates = state.projects.filter(p => p.id === id || p.aliases.includes(id));
    if (folder) candidates = candidates.filter(p => p.key === directoryKey(folder) || [p.sourcePath, ...p.pathAliases].some(a => directoryKey(a) === directoryKey(folder)));
    if (candidates.length > 1) throw new Error("有多个同名项目，请同时指定准确的项目目录。");
    const project = candidates[0];
    if (project?.removed && !includeRemoved) throw new Error("此项目已从工作台移除，请通过‘使用已有目录’重新加入。");
    return project;
  }
  async locate(project: ProjectRecord): Promise<string> {
    const actual = await directory(project.sourcePath);
    if (directoryKey(actual) !== project.key) throw new Error("项目目录链接的位置已变化，请核对实际位置。");
    return project.path;
  }
  async mutate(id: string, folder: string | undefined, work: (p: ProjectRecord) => void): Promise<void> {
    await this.update(async state => { const p = this.resolve(state, id, folder); if (!p) throw new Error("项目未加入工作台。"); await this.locate(p); work(p); });
  }
  async create(parent: string, title: string, requestId: string): Promise<ProjectRecord> {
    if (!requestId || requestId.length > 200) throw new Error("请重新打开新建窗口后重试。");
    const actual = await directory(parent);
    const clean = projectTitle(title);
    if (!clean || clean === "." || clean === "..") throw new Error("请填写有效的项目名称。");
    const receiptFile = join(this.dataDir, `project-create-${createHash("sha256").update(requestId).digest("hex")}.json`);
    return serial(this.file, async () => {
      const state = await this.read(); if (!state) throw new Error("项目记录尚未初始化。");
      let receipt: { parent: string; title: string; path: string; created: boolean } | undefined;
      try { receipt = z.object({ parent: z.string(), title: z.string(), path: z.string(), created: z.boolean() }).parse(JSON.parse(await readFile(receiptFile, "utf8"))); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("创建记录无法读取，请保留现场并重试。", { cause: error }); }
      if (receipt && (receipt.parent !== actual || receipt.title !== clean || dirname(receipt.path) !== actual)) throw new Error("这次创建的名称或位置已改变，请重新发起创建。");
      const registered = receipt && state.projects.find(p => p.key === directoryKey(receipt!.path));
      if (registered?.removed) throw new Error("这个项目已移除，请通过‘使用已有目录’明确重新加入。");
      if (!receipt) {
        const base = datedProjectName(clean); let path = join(actual, base), n = 1;
        while (await lstat(path).then(() => true, error => { if (error.code === "ENOENT") return false; throw error; })) path = join(actual, `${base}-${++n}`);
        receipt = { parent: actual, title: clean, path, created: false }; await atomic(receiptFile, receipt);
      }
      if (!receipt.created) {
        // Persisted reservation is not ownership of an externally created directory.
        let owned = false;
        try { const marker = JSON.parse(await readFile(join(receipt.path, ".dsh-creator-workbench", "project.json"), "utf8")); owned = marker.creationId === requestId && marker.schemaVersion === 1; } catch { /* Only our durable receipt can authorize reuse. */ }
        if (!owned) {
          await mkdir(receipt.path).catch(error => { if (error.code === "EEXIST") throw new Error("预定名称已存在，尚未确认归属；请用‘使用已有目录’核对并加入。"); throw error; });
          try {
            const meta = join(receipt.path, ".dsh-creator-workbench"); await mkdir(meta);
            await atomic(join(meta, "project.json"), { schemaVersion: 1, creationId: requestId });
          } catch (error) { throw new Error(`文件夹已创建，创建记录未完成；请通过‘使用已有目录’加入：${receipt.path}`, { cause: error }); }
        }
        receipt.created = true; await atomic(receiptFile, receipt);
      }
      try {
        const folder = await directory(receipt.path);
        if (directoryKey(folder) !== directoryKey(receipt.path)) throw new Error("新建项目的位置已变化，请核对目录。");
        const marker = JSON.parse(await readFile(join(folder, ".dsh-creator-workbench", "project.json"), "utf8"));
        if (marker.schemaVersion !== 1 || marker.creationId !== requestId) throw new Error("创建记录与项目目录不一致。");
        const p = register(state, folder);
        rememberLocation(state, actual, parent); await this.save(state); return p;
      } catch (error) { throw new Error(`文件夹已创建，尚未确认加入工作台；请重试登记原目录：${receipt.path}`, { cause: error }); }
    });
  }
}

/** Legacy scanner receives a project-local view; global basename collisions cannot leak through. */
export function projectOverlay(project: ProjectRecord, global: OverlayStore): OverlayStore {
  const root = dirname(project.path), name = basename(project.path);
  return { ...global, items: { [name]: project.item }, videoSelections: { [root]: { ...(project.selectedVideo !== undefined ? { [name]: project.selectedVideo } : {}) } }, hiddenVideos: { [root]: { [name]: project.hiddenVideos } } };
}
