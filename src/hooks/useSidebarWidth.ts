import { createContext, useContext } from "react";

export const SidebarWidthContext = createContext(250);

export function useSidebarWidth() {
  return useContext(SidebarWidthContext);
}
