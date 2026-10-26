import { useEffect, useRef, useState } from "react";
import {
  Button,
  IconBrowseOutlineRegular,
  IconCloseFillRegular,
  IconProjectAddOutlineRegular,
  IconRefreshOutlineRegular,
  IconSearchOutlineRegular,
  Input,
  Modal,
  Tooltip,
} from "@deepseek-ai/dsh-client-ui-primitives";

import { datedProjectName } from "../../projectNames.ts";
import type { ContentSummary } from "../../types.ts";
import { CoverThumb, coverThumbRevision } from "../CoverThumb.tsx";
import type { CreatorViewFace } from "../face.ts";
import { captureContentSelection, useLibraryEpoch, useSelectedContentId } from "../contentSelection.ts";
import type { CreatorKey } from "../locales.ts";
import { formatRelativeTime } from "../relativeTime.ts";
import { StatusPill } from "../ui/StatusPill.tsx";
import { WORKFLOW_TONE } from "../workflowTone.ts";
import "./ContentSidebarPanel.css";

function sortByRecency(items: ContentSummary[]): ContentSummary[] {
  return [...items].sort((a, b) => {
    if (a.recordedAt !== b.recordedAt) return b.recordedAt - a.recordedAt;
    return b.createdMs - a.createdMs;
  });
}

export function ContentSidebarPanel({
  t,
  suspended = false,
  ready,
  captureNavigation,
  listContents,
  getCoverThumb,
  refreshCatalog,
  createContent, getSettings, getProjectLocations, pickDirectory,
  setContentVisibility,
  inspectProject, removeProject, joinProject,
}: CreatorViewFace & {
  t: (key: CreatorKey) => string;
  suspended?: boolean;
}) {
  const requestVersion = useRef(0);
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRoot = useRef<HTMLDivElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const libraryEpoch = useLibraryEpoch();
  const [selectedId, setSelectedId] = useSelectedContentId();
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;
  const [items, setItems] = useState<ContentSummary[]>([]);
  const [removalTasks, setRemovalTasks] = useState<string[]>([]);
  const [inspecting, setInspecting] = useState(false);
  const [deleteItem, setDeleteItem] = useState<ContentSummary | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const currentEpoch = useRef(libraryEpoch);
  currentEpoch.current = libraryEpoch;
  const [error, setError] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createParent, setCreateParent] = useState("");
  const [parents, setParents] = useState<string[]>([]);
  const [parentBusy, setParentBusy] = useState(false);
  const createRequest = useRef(crypto.randomUUID());
  const pickingParent = useRef(false);
  useEffect(() => {
    if (!createOpen) return;
    let live = true; setParentBusy(true); setCreateError(undefined); setCreateParent(""); createRequest.current = crypto.randomUUID();
    void (getProjectLocations?.() ?? getSettings()).then(settings => { if (!live) return; setParents(settings.projectLocations?.map(p => p.path) ?? [settings.libraryRoot]); setCreateParent(settings.libraryConfirmed ? settings.libraryRoot : ""); }, cause => { if (live) setCreateError(cause instanceof Error ? cause.message : "保存位置读取失败，请重试。"); }).finally(() => { if (live) setParentBusy(false); });
    return () => { live = false; };
  }, [createOpen]);
  const chooseParent = async () => {
    if (pickingParent.current) return;
    pickingParent.current = true; setParentBusy(true);
    try { const path = await pickDirectory(); if (path) { setCreateError(undefined); setParents(values => [...new Set([...values, path])]); setCreateParent(path); createRequest.current = crypto.randomUUID(); } }
    catch (cause) { setCreateError(cause instanceof Error ? cause.message : "目录选择失败。"); }
    finally { pickingParent.current = false; setParentBusy(false); }
  };
  const [createError, setCreateError] = useState<string | undefined>(undefined);

  const loadList = async (nextQuery = query) => {
    if (suspended) return;
    const ticket = ++requestVersion.current;
    const isCurrent = captureNavigation();
    if (!ready()) {
      setError(t("empty.remote"));
      return;
    }
    setLoading(true);
    setError(undefined);
    try {
      const result = await listContents(nextQuery, "all");
      if (ticket !== requestVersion.current || !isCurrent()) return;
      setItems(sortByRecency(result.items));
      if (result.cleanupWarnings?.length) setError(result.cleanupWarnings.join("；"));
      const currentId = selectedIdRef.current;
      if (nextQuery === "" && currentId !== null && !result.items.some((item) => item.id === currentId)) {
        const old = result.items.filter(item => item.folderPath.replace(/[\\/]+$/, "").split(/[\\/]/).at(-1) === currentId);
        setSelectedId(old.length === 1 ? old[0]!.id : null);
      }
    } catch (cause) {
      if (ticket === requestVersion.current) setError(cause instanceof Error ? cause.message : t("empty.error"));
    } finally {
      if (ticket === requestVersion.current) setLoading(false);
    }
  };

  useEffect(() => {
    requestVersion.current += 1;
    if (suspended) setDeleteItem(null);
    if (suspended) return;
    const handle = window.setTimeout(() => {
      void loadList(query);
    }, 200);
    return () => {
      requestVersion.current += 1;
      window.clearTimeout(handle);
    };
  }, [query, libraryEpoch, suspended]);

  useEffect(() => {
    if (!searchOpen) return;
    searchInput.current?.focus({ preventScroll: true });
  }, [searchOpen]);

  useEffect(() => {
    if (!searchOpen) return;
    const onClick = (event: MouseEvent): void => {
      if (!(event.target instanceof Node) || searchRoot.current?.contains(event.target) === true) {
        return;
      }
      searchInput.current?.blur();
      if (query !== "") return;
      setSearchOpen(false);
    };
    document.addEventListener("click", onClick);
    return () => { document.removeEventListener("click", onClick); };
  }, [searchOpen, query]);

  const closeSearch = (): void => {
    setQuery("");
    setSearchOpen(false);
  };

  const closeCreate = (): void => {
    if (creating || parentBusy) return;
    setCreateOpen(false);
    setCreateName("");
    setCreateError(undefined);
  };

  const onCreate = async () => {
    const title = createName.trim();
    if (title === "" || creating || parentBusy || !createParent) return;
    const isCurrent = captureNavigation();
    const originalSelection = selectedIdRef.current;
    setCreating(true);
    setCreateError(undefined);
    try {
      const created = await createContent(title, createParent, createRequest.current);
      if (!isCurrent()) return;
      setCreateOpen(false);
      setCreateName("");
      await loadList(query);
      if (isCurrent() && selectedIdRef.current === originalSelection) setSelectedId(created.id);
    } catch (cause) {
      setCreateError(cause instanceof Error ? cause.message : t("create.failed"));
    } finally {
      setCreating(false);
    }
  };

  const changeVisibility = async (item: ContentSummary, hidden: boolean) => {
    if (updatingId || suspended) return;
    const selectionCurrent = captureContentSelection();
    setUpdatingId(item.id); setError(undefined);
    try {
      if (hidden && removeProject) await removeProject(item.id, item.folderPath, removalTasks.length > 0);
      else await setContentVisibility(item.id, item.folderPath, hidden);
      requestVersion.current += 1;
      if (hidden) setItems((rows) => rows.filter((row) => row.folderPath !== item.folderPath));
      if (hidden && selectionCurrent() && selectedIdRef.current === item.id) setSelectedId(null);
      setDeleteItem(null);
      await loadList(query);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("empty.error"));
    } finally { setUpdatingId(null); }
  };

  return (
    <div
      className="contentPanel"
      data-plugin="dsh-creator-workbench"
      data-surface="library"
    >
      <div className="contentHeader">
        {loading && <span className="contentRefreshStatus" role="status" aria-label="正在读取">·</span>}
        <div className={searchOpen ? "searchSlot expanded" : "searchSlot"}>
          <div
            ref={searchRoot}
            className={searchOpen ? "contentSearch expanded" : "contentSearch"}
            onClick={() => {
              if (searchOpen) return;
              setSearchOpen(true);
            }}
          >
            <Tooltip label={t("toolbar.search")} delayMs={500} disabled={searchOpen}>
              <button
                type="button"
                className="searchButton"
                aria-label={t("toolbar.search.aria")}
                aria-expanded={searchOpen}
                onClick={() => { setSearchOpen(true); }}
              >
                <IconSearchOutlineRegular size={searchOpen ? 11 : 14} />
              </button>
            </Tooltip>
            <input
              ref={searchInput}
              className="searchInput"
              value={query}
              placeholder={t("toolbar.search")}
              tabIndex={searchOpen ? 0 : -1}
              onChange={(event) => { setQuery(event.target.value); }}
              onKeyDown={(event) => {
                if (event.key !== "Escape") return;
                closeSearch();
              }}
            />
            {searchOpen && (
              <button
                type="button"
                className="clearButton"
                aria-label={t("toolbar.search.clear")}
                onClick={(event) => {
                  event.stopPropagation();
                  closeSearch();
                }}
              >
                <IconCloseFillRegular />
              </button>
            )}
          </div>
        </div>
        <div className={searchOpen ? "headerActions hidden" : "headerActions"}>
          <Tooltip label={t("toolbar.refresh")} delayMs={500}>
            <button
              type="button"
              className="iconButton"
              aria-label={t("toolbar.refresh")}
              disabled={loading}
              onClick={() => {
                setLoading(true);
                void refreshCatalog().then(() => loadList(query), (cause: unknown) => { setLoading(false); setError(cause instanceof Error ? cause.message : t("empty.error")); });
              }}
            >
              <IconRefreshOutlineRegular size={16} />
            </button>
          </Tooltip>
          <Tooltip label={t("toolbar.create")} delayMs={500}>
            <button
              type="button"
              className="iconButton"
              aria-label={t("toolbar.create.aria")}
              onClick={() => { setCreateOpen(true); }}
            >
              <IconProjectAddOutlineRegular size={16} />
            </button>
          </Tooltip>
        </div>
      </div>
      <Modal
        open={createOpen}
        onClose={closeCreate}
        title={t("create.title")}
        closeLabel={t("create.cancel")}
        footer={(
          <>
            <Button variant="outline" disabled={creating} onClick={closeCreate}>
              {t("create.cancel")}
            </Button>
            <Button
              variant="primary"
              disabled={creating || parentBusy || !createParent || createName.trim() === ""}
              onClick={() => { void onCreate(); }}
            >
              {t("create.confirm")}
            </Button>
          </>
        )}
      >
        <div data-plugin="dsh-creator-workbench" data-surface="create-dialog">
          <div className="createField">
            <label className="createLabel" htmlFor="oil-create-name">{t("create.name")}</label>
            <Input
              id="oil-create-name"
              className="createInput"
              value={createName}
              placeholder={t("create.name.placeholder")}
              autoFocus={true}
              disabled={creating}
              onChange={(event) => { setCreateName(event.target.value); createRequest.current = crypto.randomUUID(); }}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                void onCreate();
              }}
            />
          </div>
          <div className="createField">
            <label className="createLabel" htmlFor="creator-create-parent">保存到</label>
            <select id="creator-create-parent" value={createParent} disabled={creating || parentBusy} onChange={event => { setCreateParent(event.target.value); createRequest.current = crypto.randomUUID(); }}>
              <option value="" disabled>选择父目录</option>
              {parents.map(path => <option key={path} value={path}>{path}</option>)}
            </select>
            <Button variant="ghost" disabled={creating || parentBusy} onClick={() => { void chooseParent(); }}>选择其他位置</Button>
            {createParent && <div className="createPath" title={createParent}>预计路径：{createParent.replace(/[\\/]+$/, "")}{createParent.includes("\\") ? "\\" : "/"}{datedProjectName(createName || "项目名称")}</div>}
          </div>
          {createError !== undefined && <div className="createError">{createError}</div>}
          {joinProject && <Button variant="ghost" disabled={creating} onClick={() => { const selectionCurrent = captureContentSelection(), navigationCurrent = captureNavigation(); setCreating(true); void joinProject().then(async (item) => { if (item) { setCreateOpen(false); await loadList(); if (selectionCurrent() && navigationCurrent()) setSelectedId(item.id); } }, (cause: unknown) => setCreateError(cause instanceof Error ? cause.message : String(cause))).finally(() => setCreating(false)); }}>使用已有目录</Button>}
        </div>
      </Modal>
      <Modal
        open={deleteItem !== null}
        onClose={() => { if (!updatingId) setDeleteItem(null); }}
        title="删除项目"
        closeLabel="取消"
        footer={<><Button variant="outline" disabled={updatingId !== null} onClick={() => setDeleteItem(null)}>取消</Button><Button disabled={updatingId !== null || inspecting} onClick={() => { if (deleteItem) void changeVisibility(deleteItem, true); }}>{updatingId ? "正在删除…" : removalTasks.length ? "取消任务并移除" : "确认删除"}</Button></>}
      >
        <p>删除「{deleteItem?.title}」并归档本项目的工作台会话？磁盘文件保留，以后可通过“使用已有目录”重新加入。</p>
        {inspecting && <p role="status">正在检查项目…</p>}
        {removalTasks.length > 0 && <p>将停止：{[...new Set(removalTasks)].join("、")}。已生成的文件保留，远端结果不会撤回。</p>}
        {error && <p role="alert">{error}</p>}
      </Modal>
      <div className="contentList">
        {error !== undefined && !deleteItem && <div className="contentEmpty" role="alert">{error}<Button variant="ghost" onClick={() => { void loadList(); }}>重试</Button></div>}
        {error === undefined && items.length === 0 && !loading && (
          <div className="contentEmpty">{query ? "没有找到相关内容" : t("empty.library")}</div>
        )}
        {items.map((item) => (
          <div
            key={item.id}
            data-content-id={item.id}
            className={item.id === selectedId ? "contentRow selected" : "contentRow"}
          >
          <button
            type="button"
            className="contentRowSelect"
            onClick={() => {
              setSelectedId(item.id === selectedId ? null : item.id);
            }}
          >
            <span className="rowCover">
              <CoverThumb
                id={item.id}
                load={getCoverThumb}
                revision={coverThumbRevision(item.covers)}
                fallback={<IconBrowseOutlineRegular className="coverFallback" size={20} />}
              />
            </span>
            <span className="rowBody">
              <span className="rowTitle" title={`${item.title}\n${item.folderPath}`}>{item.title}</span>
              <span className="rowMeta">
                <StatusPill tone={item.accessError ? "pending" : WORKFLOW_TONE[item.workflow]}>
                  {item.accessError ? "暂不可访问" : t(`inspector.stage.${item.workflow}` as CreatorKey)}
                </StatusPill>
                <span className="rowDate">{formatRelativeTime(item.recordedAt, Date.now(), t)}</span>
              </span>
            </span>
          </button>
          <button type="button" className="contentRowDelete" aria-label={`删除项目：${item.title}`} title="删除项目" disabled={updatingId !== null} onClick={() => { setDeleteItem(item); setError(undefined); setRemovalTasks([]); if (inspectProject) { setInspecting(true); void inspectProject(item.id, item.folderPath).then(setRemovalTasks, (cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause))).finally(() => setInspecting(false)); } }}>删除</button>
          </div>
        ))}
      </div>
    </div>
  );
}
