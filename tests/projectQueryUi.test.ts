// @vitest-environment jsdom
import { createElement as h } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ProjectDataProvider, useProjectData } from "../src/client/ProjectData.tsx";
import { bumpLibrary } from "../src/client/contentSelection.ts";
import { emptyProduction } from "../src/production/types.ts";
import type { ProductionClient } from "../src/client/productionApi.ts";
import type { ProjectView } from "../src/projectView.ts";
afterEach(cleanup);
it("refreshes shared idle metadata after an external Agent/file revision, without polling settings",async()=>{
 let state=emptyProduction();
 const scope={id:"one",folderPath:"C:/external-one"};
 const api={projectView:vi.fn(async()=>({detail:scope,production:state,covers:{versions:[],selected:{},runs:[]},script:{exists:false,excerpt:""}} as unknown as ProjectView)),settings:vi.fn()} as unknown as ProductionClient;
 function Probe(){const data=useProjectData(api,scope);return h("p",null,`图片 ${data.state?.images?.length??0}`);}
 render(h(ProjectDataProvider,{api,scope,children:h(Probe)}));await screen.findByText("图片 0");
 state={...state,images:[{id:"image",file:"i.png",mime:"image/png",width:3,height:4,sha256:"hash",createdAt:1,source:"generated",purpose:"card"}]};
 await act(async()=>{bumpLibrary();});await screen.findByText("图片 1");expect(api.settings).not.toHaveBeenCalled();
});
