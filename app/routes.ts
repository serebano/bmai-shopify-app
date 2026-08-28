import { flatRoutes } from "@react-router/fs-routes";
import type { RouteConfig } from "@react-router/dev/routes";

// File-based routing: every file under app/routes/ is a route.
export default flatRoutes() satisfies RouteConfig;
