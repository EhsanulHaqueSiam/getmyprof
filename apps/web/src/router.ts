import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

/** File-based routes from src/routes. Route chunks prefetch on hover or focus intent. */
export const router = createRouter({ routeTree, defaultPreload: "intent" });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
