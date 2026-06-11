import type { ProjectType } from "./types";

export type Route =
  | { page: "home" }
  | { page: "instances" }
  | { page: "instance"; id: string }
  | { page: "browse"; projectType?: ProjectType; instanceId?: string }
  | {
      page: "project";
      projectId: string;
      projectType: ProjectType;
      instanceId?: string;
    }
  | { page: "accounts" }
  | { page: "settings" };
