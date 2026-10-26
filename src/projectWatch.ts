import { watch, type FSWatcher } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { createDebounced, shouldIgnoreWatchName } from "./libraryWatch.ts";
import { readState, inside } from "./production/storage.ts";
import { readCoverState, boundedFile } from "./covers/files.ts";
import { boundedRead } from "./fsReadDeadline.ts";

/** Watch only saved parents, project roots and known workbench files. Never descend a media tree. */
export function startProjectWatch(options: {
  parents: string[]; projects: string[]; dataDir: string;
  onChange: () => void; onDiscover: () => Promise<void>;
  interval?: number; readTimeout?: number;
}): { close: () => void; ready: Promise<void> } {
  let closed = false, polling = false, previous: string | undefined, previousParents: string | undefined;
  const watchers = new Map<string, FSWatcher>();
  const changed = createDebounced(() => { if (!closed) options.onChange(); }, 300);
  let discovery = false;
  const discover = createDebounced(() => {
    if (closed || discovery) return; discovery = true;
    void options.onDiscover().catch(() => { if (!closed) options.onChange(); }).finally(() => { discovery = false; });
  }, 400);
  const parents = new Set(options.parents), projects = new Set(options.projects);
  const directories = [...new Set([...options.parents, options.dataDir, ...options.projects.flatMap(path => [path, join(path, ".dsh-creator-workbench"), join(path, ".dsh-creator-workbench", "production"), join(path, ".dsh-creator-workbench", "covers"), join(path, "公众号文章")])])];
  const read = <T,>(value: Promise<T>) => boundedRead(value, options.readTimeout ?? 2000);
  const poll = async () => {
    if (closed || polling) return; polling = true;
    try {
      const batches = await Promise.all(directories.map(async path => {
        const rows: string[] = [], parentRows: string[] = [];
        let entries;
        try { entries = await read(readdir(path, { withFileTypes: true })); }
        catch { rows.push(`${path}:unavailable`); if (parents.has(path)) parentRows.push(`${path}:unavailable`); return { rows, parentRows }; }
        if (closed) return { rows, parentRows };
        if (!watchers.has(path)) try {
          const watcher = watch(path, { persistent: false, recursive: false }, (_event, name) => {
            if (closed || shouldIgnoreWatchName(name?.toString() ?? null)) return;
            changed.trigger(); if (parents.has(path)) discover.trigger();
          });
          watcher.on("error", () => { watcher.close(); watchers.delete(path); });
          if (closed) { watcher.close(); return { rows, parentRows }; } watchers.set(path, watcher);
        } catch { /* The bounded fingerprint is the fallback. */ }
        rows.push(path);
        for (const entry of entries.sort((a,b) => a.name.localeCompare(b.name))) {
          if (closed) break;
          if (shouldIgnoreWatchName(entry.name)) continue;
          if (parents.has(path)) {
            if (entry.isDirectory() || entry.isSymbolicLink()) {
              const child = join(path, entry.name); parentRows.push(child);
              const markers = await Promise.all(["project.json", "production/index.json", "covers/index.json"].map(async file => {
                const info = await read(stat(join(child, ".dsh-creator-workbench", file))).catch(() => undefined);
                return `${child}/${file}:${info?.size}:${info?.mtimeMs}`;
              })); parentRows.push(...markers);
            }
            if (!projects.has(path)) continue;
          }
          if (entry.isFile()) { const info = await read(stat(join(path, entry.name))).catch(() => undefined); rows.push(`${path}/${entry.name}:${info?.size}:${info?.mtimeMs}`); }
        }
        return { rows, parentRows };
      }));
      const known = await Promise.all(options.projects.map(async folder => {
        const rows: string[] = [];
        const [state, covers] = await Promise.all([read(readState(folder)).catch(() => undefined), read(readCoverState(folder)).catch(() => undefined)]);
        if (closed) return rows;
        const files = [...new Set([...(state?.articles.map(a => a.file) ?? []), ...(state?.publications?.map(p => p.bodyFile) ?? []), ...(state?.transcripts.flatMap(t => [t.textFile, t.srtFile]) ?? [])])];
        for (const file of files) {
          const actual = await read(inside(folder, file)).catch(() => undefined), info = actual ? await read(stat(actual)).catch(() => undefined) : undefined;
          if (closed) return rows; rows.push(`${folder}/${file}:${info?.size}:${info?.mtimeMs}`);
        }
        for (const version of covers?.versions ?? []) {
          const actual = await read(boundedFile(folder, version.file)).catch(() => undefined), info = actual ? await read(stat(actual)).catch(() => undefined) : undefined;
          if (closed) return rows; rows.push(`${folder}/${version.file}:${info?.size}:${info?.mtimeMs}`);
        }
        return rows;
      }));
      if (closed) return;
      const next = [...batches.flatMap(b => b.rows), ...known.flat()].join("|");
      if (previous !== undefined && next !== previous) changed.trigger();
      const parentNext = batches.flatMap(b => b.parentRows).join("|");
      if (previousParents !== undefined && parentNext !== previousParents) { changed.trigger(); discover.trigger(); }
      previous = next; previousParents = parentNext;
    } finally { polling = false; }
  };
  const ready = poll();
  const timer = setInterval(() => { void poll().catch(() => { if (!closed) options.onChange(); }); }, options.interval ?? 4000); timer.unref?.();
  return { ready, close: () => { closed = true; clearInterval(timer); changed.cancel(); discover.cancel(); for (const watcher of watchers.values()) watcher.close(); watchers.clear(); } };
}
