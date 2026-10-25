import type { ProductionAction, PublicationDraft, PublicationInput } from "../production/types.ts";

export const publicationInput = (p: PublicationDraft): PublicationInput => ({ platform: p.platform, type: p.type, title: p.title, body: p.body ?? "", tags: [...p.tags], imageIds: [...p.imageIds], ...(p.video ? { video: p.video } : {}), ...(p.articleId ? { articleId: p.articleId } : {}), ...(p.articleFile ? { articleFile: p.articleFile } : {}), ...(p.coverImageId ? { coverImageId: p.coverImageId } : {}), ...(p.coverFiles ? { coverFiles: p.coverFiles } : {}), ...(p.category ? { category: p.category } : {}), ...(p.source ? { source: p.source } : {}) });
type SaveAction = Extract<ProductionAction, { action: "save-publication" }>;
export interface PublicationEditSnapshot {
  key: string; publicationId?: string | undefined; revision?: number | undefined; input: PublicationInput; baseline: string;
  pending?: SaveAction | undefined; phase: "saved" | "pending" | "saving" | "error" | "conflict"; error?: string | undefined;
}
type Receipt = { id: string; revision: number; input?: PublicationInput };
type Send = (request: SaveAction) => Promise<Receipt>;
export interface DraftStorage { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }
const copy = <T,>(value: T): T => structuredClone(value);
const serialize = (input: PublicationInput) => JSON.stringify(input);

/** Survives page unmounts. Each material owns its queue and exact uncertain request. */
export class PublicationEditor {
  private state: PublicationEditSnapshot;
  private listeners = new Set<() => void>();
  private timer?: ReturnType<typeof setTimeout>;
  private flight: Promise<void> | undefined;
  private holds = 0;
  private retired = false;
  constructor(initial: PublicationEditSnapshot, private readonly send: Send, private readonly persist: (value: PublicationEditSnapshot) => void, private readonly delay = 700) {
    this.state = copy(initial);
    if (this.state.phase === "saving") this.state.phase = "pending";
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  get dirty() { return serialize(this.state.input) !== this.state.baseline || Boolean(this.state.pending); }
  private emit(next: Partial<PublicationEditSnapshot>) {
    this.state = { ...this.state, ...next };
    // Persist the exact operation before dispatch. Failure must stop remote writes.
    try { this.persist(this.state); }
    catch { this.state = { ...this.state, phase: "error", error: "本地草稿无法保存，请保留输入后重试。" }; for (const l of this.listeners) l(); throw new Error(this.state.error); }
    for (const l of this.listeners) l();
  }
  update(input: PublicationInput) {
    if (this.retired) return;
    if (input.platform !== this.state.input.platform || input.type !== this.state.input.type) throw new Error("请为其他平台或形式另建材料。");
    try { this.emit({ input: copy(input), phase: this.state.phase === "conflict" ? "conflict" : this.state.phase === "saving" ? "saving" : "pending", error: this.state.phase === "conflict" ? this.state.error : undefined }); this.schedule(); } catch { /* Kept in memory and surfaced in state. */ }
  }
  resume() { if (this.dirty && !["error", "conflict"].includes(this.state.phase)) this.schedule(); }
  private schedule() {
    clearTimeout(this.timer);
    if (this.retired || this.holds || this.state.phase === "conflict") return;
    this.timer = setTimeout(() => { void this.flush().catch(() => undefined); }, this.delay);
  }
  private async pump() {
    while (this.dirty) {
      if (this.state.phase === "conflict") throw new Error(this.state.error);
      const operation = this.state.pending ?? {
        action: "save-publication" as const, id: "", folderPath: "", saveId: crypto.randomUUID(),
        ...(this.state.publicationId ? { publicationId: this.state.publicationId, expectedRevision: this.state.revision! } : {}), input: copy(this.state.input),
      };
      this.emit({ pending: operation, phase: "saving", error: undefined });
      try {
        const receipt = await this.send(copy(operation));
        const unchanged=serialize(this.state.input)===serialize(operation.input),acknowledged=unchanged&&receipt.input?copy(receipt.input):operation.input;
        this.emit({ publicationId: receipt.id, revision: receipt.revision, ...(unchanged?{input:acknowledged}:{}), baseline: serialize(acknowledged), pending: undefined, phase: unchanged ? "saved" : "pending", error: undefined });
      } catch (e) {
        const error = e instanceof Error ? e.message : "保存未完成，请重试。";
        this.emit({ phase: /发布内容已被修改|读取后合并/.test(error) ? "conflict" : "error", error });
        throw e;
      }
    }
    if (this.state.phase !== "saved") this.emit({ phase: "saved", error: undefined });
  }
  async flush(): Promise<Receipt & { input: PublicationInput }> {
    if (this.retired) throw new Error("发布内容已移除。");
    clearTimeout(this.timer);
    if (!this.flight) {
      this.flight = this.pump();
      void this.flight.finally(() => { this.flight = undefined; }).catch(() => undefined);
    }
    await this.flight;
    if (this.dirty) return this.flush();
    if (!this.state.publicationId || !this.state.revision) throw new Error("发布材料尚未保存。");
    return { id: this.state.publicationId, revision: this.state.revision, input: copy(this.state.input) };
  }
  async withSaved<T>(work: (saved: Receipt & { input: PublicationInput }) => Promise<T>): Promise<T> {
    this.holds++;
    try { return await work(await this.flush()); }
    finally { this.holds--; if (this.dirty) this.schedule(); }
  }
  /** Read-side refresh cannot replace local typing or an uncertain operation. */
  acceptRemote(p: PublicationDraft) {
    if (p.id !== this.state.publicationId || !p.body && p.body !== "" || this.dirty || p.revision <= (this.state.revision ?? 0)) return;
    const input = publicationInput(p); this.emit({ input, revision: p.revision, baseline: serialize(input), phase: "saved" });
  }
  dispose() { this.retired = true; clearTimeout(this.timer); }
}

export class PublicationEditors {
  private rows = new Map<string, PublicationEditor>();
  private version = 0;
  private listeners = new Set<() => void>();
  getSnapshot = () => this.version;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  private storageKey: string;
  constructor(folder: string, private readonly send: Send, private readonly storage?: DraftStorage, private readonly delay = 700) {
    this.storageKey = `dsh-creator-workbench:publication-editors:v1:${folder.replaceAll("\\", "/").replace(/\/$/, "").toLowerCase()}`;
    let saved: PublicationEditSnapshot[] = [];
    try { saved = JSON.parse(storage?.getItem(this.storageKey) ?? "[]"); } catch { /* Server files remain authoritative for saved materials. */ }
    for (const row of saved) if (row?.key && row.input && typeof row.input.body === "string") this.make(row);
  }
  private persist = () => { this.version++; for (const l of this.listeners) l(); this.storage?.setItem(this.storageKey, JSON.stringify([...this.rows.values()].map(e => e.getSnapshot()))); };
  private make(row: PublicationEditSnapshot) {
    const editor = new PublicationEditor(row, this.send, this.persist, this.delay); this.rows.set(row.key, editor); return editor;
  }
  list() { return [...this.rows.values()]; }
  forId(id: string) { return this.list().find(e => e.getSnapshot().publicationId === id); }
  create(input: PublicationInput) {
    const editor = this.make({ key: crypto.randomUUID(), input: copy(input), baseline: "", phase: "pending" });
    try { this.persist(); } catch { /* The queued save will surface the storage failure before dispatch. */ } editor.resume(); return editor;
  }
  open(p: PublicationDraft) {
    let editor = this.forId(p.id);
    if (editor) editor.acceptRemote(p);
    else { const input = publicationInput(p); editor = this.make({ key: p.id, publicationId: p.id, revision: p.revision, input, baseline: serialize(input), phase: "saved" }); }
    this.persist(); editor.resume(); return editor;
  }
  resume() { for (const e of this.rows.values()) e.resume(); }
  remove(key: string) { this.rows.get(key)?.dispose(); this.rows.delete(key); this.persist(); }
}
