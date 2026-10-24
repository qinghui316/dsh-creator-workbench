import { useLibraryEpoch } from "./contentSelection.ts";
import { createContext, useContext, useMemo, useSyncExternalStore, useEffect, useRef, type ReactNode } from "react";
import type { ContentScope } from "../production/types.ts";
import type { ProductionClient } from "./productionApi.ts";
import { projectQuery, type ProjectQuery } from "./projectQuery.ts";

const ProjectContext = createContext<ProjectQuery | undefined>(undefined);
export function ProjectDataProvider({ api, scope, children }: { api: ProductionClient; scope: ContentScope; children: ReactNode }) {
  const query = useMemo(() => projectQuery(api, scope), [api, scope.folderPath]);
  const epoch = useLibraryEpoch(), previousEpoch = useRef(epoch);
  useSyncExternalStore(query.subscribe, query.getSnapshot);
  useEffect(() => { if (previousEpoch.current !== epoch) { previousEpoch.current = epoch; void query.invalidate().catch(() => undefined); } }, [query, epoch]);
  return <ProjectContext.Provider value={query}>{children}</ProjectContext.Provider>;
}
export function useProjectData(api: ProductionClient, scope: ContentScope) {
  const inherited = useContext(ProjectContext);
  const query = useMemo(() => inherited ?? projectQuery(api, scope), [inherited, api, scope.folderPath]);
  const snapshot = useSyncExternalStore(query.subscribe, query.getSnapshot);
  return { ...snapshot, query };
}
