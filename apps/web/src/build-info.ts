interface BuildInfo {
  version: string;
  channel: "development" | "check" | "preview" | "stable";
  commit: string;
  databaseVersion: number;
  archiveVersion: number;
  apiVersion: number;
}
declare const __AIREADER_BUILD__: BuildInfo;

// Vite dev serves the same source without pretending it is a release binary.
export const buildInfo = typeof __AIREADER_BUILD__ === "undefined" ? undefined : __AIREADER_BUILD__;
