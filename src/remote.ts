import type { TypertRemoteContribution } from "@deepseek-ai/dsh-typert-protocol";

import { CREATOR_WORKBENCH_INVOCATIONS, PACKAGE_NAME } from "./remote-contract.ts";

export const TYPERT_REMOTE: TypertRemoteContribution = {
  package: PACKAGE_NAME,
  descriptors: CREATOR_WORKBENCH_INVOCATIONS,
};

export default TYPERT_REMOTE;
