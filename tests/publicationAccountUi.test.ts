// @vitest-environment jsdom
import { createElement as h } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PublicationResults } from "../src/client/PublicationResults.tsx";
import type { ContentDetail } from "../src/types.ts";
import type { ProductionClient } from "../src/client/productionApi.ts";
import type { PublicationEditSnapshot } from "../src/client/publicationAutosave.ts";
import { emptyProduction } from "../src/production/types.ts";
vi.mock("@deepseek-ai/dsh-client-ui-primitives",()=>({Button:({children,variant,size,...props}:Record<string,unknown>)=>h("button",props,children as never)}));
afterEach(cleanup);
it("isolates same-ID candidates by account and clears a selected A work before B can submit",async()=>{
 const detail={id:"p",folderPath:"E:/candidate-ui"}as ContentDetail;
 const state={...emptyProduction(),candidates:[{platform:"xiaohongshu"as const,accountId:"A",remoteId:"same",title:"A的作品"},{platform:"xiaohongshu"as const,accountId:"B",remoteId:"same",title:"B的作品"}]};
 const api={state:async()=>state}as unknown as ProductionClient,run=vi.fn(async()=>state),edit:PublicationEditSnapshot={key:"pub",publicationId:"pub",revision:1,baseline:"",phase:"saved",input:{platform:"xiaohongshu",type:"images",title:"title",body:"",imageIds:[],tags:[]}};
 const view=render(h(PublicationResults,{detail,api,edit,accountId:"A",run}));await screen.findByText("关联已发表的作品后查看数据");fireEvent.click(screen.getByRole("button",{name:"关联已发表作品"}));await screen.findByText("A的作品");expect(screen.queryByText("B的作品")).toBeNull();fireEvent.click(screen.getByRole("button",{name:"选择此作品"}));
 view.rerender(h(PublicationResults,{detail,api,edit,accountId:"B",run}));await waitFor(()=>expect(screen.queryByLabelText("作品标识")).toBeNull());expect(run).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole("button",{name:"关联已发表作品"}));expect(screen.getByText("B的作品")).toBeTruthy();expect(screen.queryByText("A的作品")).toBeNull();fireEvent.click(screen.getByRole("button",{name:"选择此作品"}));fireEvent.click(screen.getByRole("button",{name:"保存关联并读取数据"}));await waitFor(()=>expect(run).toHaveBeenCalledWith(expect.objectContaining({expectedAccountId:"B",candidateAccountId:"B",remoteId:"same"})));
});
