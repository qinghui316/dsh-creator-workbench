import type { ComponentProps } from "react";
import { PublicationPanel } from "./PublicationPanel.tsx";
import { ImageLibraryPanel } from "./ImageLibraryPanel.tsx";
/** Compatibility composition; live navigation mounts each feature on its own tab. */
export function CreationPanel(props: ComponentProps<typeof PublicationPanel>) { return <><ImageLibraryPanel detail={props.detail} api={props.api} /><PublicationPanel {...props} /></>; }
