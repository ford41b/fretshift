import type { SyncRecord } from "./adapter";
export type ConflictChoice = "mine" | "server" | "both";
export type SyncConflict = {
  key: string;
  mine: SyncRecord;
  server: SyncRecord;
  choices: readonly ConflictChoice[];
};
