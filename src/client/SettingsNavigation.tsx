import { createContext, useContext } from "react";
export type SettingsGroup = "image" | "general" | "platforms" | "asr" | "wechat";
export const SettingsNavigation = createContext<(group: SettingsGroup) => void>(() => undefined);
export const useSettingsNavigation = () => useContext(SettingsNavigation);
