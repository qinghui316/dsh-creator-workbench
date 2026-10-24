import { productionView, type ProductionView, type ProjectView } from "../projectView.ts";
import { isActiveTask, type ContentScope, type ProductionState, type ProductionSettingsView } from "../production/types.ts";
import type { ProductionClient } from "./productionApi.ts";

export interface ProjectSnapshot { view?: ProjectView; state?: ProductionView; settings?: ProductionSettingsView; error?: string | undefined }
async function bounded<T>(request: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([request, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("状态暂不可用，请重新查询原任务。")), 15000); })]); }
  finally { clearTimeout(timer); }
}
const settingsCache = new WeakMap<ProductionClient, Promise<ProductionSettingsView>>();
/** One request/clock per mounted project; drafts are deliberately outside this cache. */
export class ProjectQuery {
  snapshot: ProjectSnapshot = {};
  private listeners = new Set<() => void>();
  private request: Promise<ProductionView> | undefined;
  private readTicket = 0;
  private epoch = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private recovery: Promise<unknown> | undefined;
  private reconciled = false;
  constructor(readonly api: ProductionClient, readonly scope: ContentScope) {}
  subscribe = (listener: () => void) => { this.listeners.add(listener); if (this.listeners.size === 1) void this.open(); return () => { this.listeners.delete(listener); if (!this.listeners.size) { clearTimeout(this.timer); this.timer = undefined; } }; };
  getSnapshot = () => this.snapshot;
  private emit() { for (const listener of this.listeners) listener(); }
  seed(view: ProjectView) { if (!this.snapshot.view) { this.snapshot = { ...this.snapshot, view, state: view.production }; this.emit(); } }
  private async open() {
    try { if (!this.reconciled) { this.recovery ??= bounded(Promise.resolve(this.api.reconcile?.(this.scope))); await this.recovery; this.reconciled = true; } await this.refresh(); }
    catch (error) { this.recovery = undefined; this.fail(error); }
  }
  private fail(error: unknown) { this.snapshot = { ...this.snapshot, error: error instanceof Error ? error.message : "读取失败，请重试。" }; this.emit(); }
  private schedule() {
    clearTimeout(this.timer);
    const running = this.snapshot.state?.tasks.some(isActiveTask) || this.snapshot.view?.covers.runs.some(r => ["running", "preparing"].includes(r.status));
    if (this.listeners.size && running) this.timer = setTimeout(() => { void this.refresh().catch(() => undefined); }, 2000);
  }
  refresh = (): Promise<ProductionView> => {
    if (this.request) return this.request;
    const epoch = this.epoch, ticket = ++this.readTicket;
    const work = async () => {
      try {
        const view = this.api.projectView ? await bounded(this.api.projectView(this.scope)) : undefined, state = view?.production ?? await bounded(this.api.state(this.scope));
        if (epoch === this.epoch) {
          if (view?.settingsRevision && this.snapshot.view?.settingsRevision && view.settingsRevision !== this.snapshot.view.settingsRevision) { settingsCache.delete(this.api); if(this.snapshot.settings) void this.settings().catch(()=>undefined); }
          this.snapshot = { ...this.snapshot, ...(view ? { view } : {}), state, error: undefined }; this.emit(); }
        return state;
      } catch (error) { if (epoch === this.epoch) this.fail(error); throw error; }
      finally { if (ticket === this.readTicket) { this.request = undefined; this.schedule(); } }
    };
    this.request = work(); return this.request;
  };
  accept = (full: ProductionState) => { const state = productionView(full); this.epoch++; this.snapshot = { ...this.snapshot, state, ...(this.snapshot.view ? { view: { ...this.snapshot.view, production: state } } : {}), error: undefined }; this.emit(); this.schedule(); };
  invalidate = () => { this.epoch++; this.request = undefined; return this.refresh(); };
  retry = async () => {
    try { if (this.api.reconcile) await bounded(this.api.reconcile(this.scope)); this.reconciled = true; this.recovery = undefined; return await this.invalidate(); }
    catch (error) { this.recovery = undefined; this.fail(error); throw error; }
  };
  settings = async () => {
    let request = settingsCache.get(this.api);
    if (!request) { request = this.api.settings(); settingsCache.set(this.api, request); request.catch(() => settingsCache.delete(this.api)); }
    const settings = await request; this.snapshot = { ...this.snapshot, settings }; this.emit(); return settings;
  };
}
const queries = new WeakMap<ProductionClient, Map<string, ProjectQuery>>();
export function projectQuery(api: ProductionClient, scope: ContentScope) {
  let bucket = queries.get(api); if (!bucket) { bucket = new Map(); queries.set(api, bucket); }
  const key = scope.folderPath.replace(/\\/g, "/").replace(/\/$/, "");
  let query = bucket.get(key); if (!query) { query = new ProjectQuery(api, scope); bucket.set(key, query); }
  return query;
}
export function invalidateProjectSettings(api: ProductionClient) { settingsCache.delete(api); }
