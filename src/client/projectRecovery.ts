type Binding = { folder: string };
/** History recovery is background-only; current navigation awaits at most its own hint. */
export function projectRecovery(options: {
  bindings: () => Record<string, Binding>;
  owns: (session: string) => boolean;
  recover: (session: string, folder: string) => Promise<unknown>;
  changed: () => void;
  timeout?: number;
}) {
  const recovered = new Set<string>(), pending = new Map<string, Promise<void>>();
  let history: Promise<void> | undefined;
  const one = (session: string, folder: string): Promise<void> => {
    const key = session + "\n" + folder;
    if (recovered.has(key) || !options.owns(session)) return Promise.resolve();
    const active = pending.get(key); if (active) return active;
    const work = (async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([options.recover(session, folder), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("原会话查询超时")), options.timeout ?? 4000); })]);
        recovered.add(key); options.changed();
      } catch { /* Keep registered projects usable; an unproven hint is not a project. */ }
      finally { clearTimeout(timer); pending.delete(key); }
    })();
    pending.set(key, work); return work;
  };
  return {
    one,
    history: () => {
      if (history) return history;
      const entries = Object.entries(options.bindings()); let index = 0;
      history = Promise.all(Array.from({ length: Math.min(4, entries.length) }, async () => { for (;;) { const pair = entries[index++]; if (!pair) return; await one(pair[0], pair[1].folder); } })).then(() => undefined).finally(() => { history = undefined; });
      return history;
    },
  };
}
