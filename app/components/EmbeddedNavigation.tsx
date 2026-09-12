import { createContext, useContext } from "react";
import { embeddedAppUrl, type EmbeddedNavigation } from "../lib/embeddedNavigation";

export const EmbeddedNavigationContext = createContext<EmbeddedNavigation | null>(null);
export function useEmbeddedAppUrl(destination: string): string {
  return embeddedAppUrl(destination, useContext(EmbeddedNavigationContext));
}
