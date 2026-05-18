export interface Destination {
  id: string;
  name: string;
  notebookUrl: string;
  createdAt: string;
  updatedAt: string;
}

export interface AppSettings {
  destinations: Destination[];
  selectedDestinationIds: string[];
  dailyDestinationEnabled: boolean;
}

export interface CurrentPage {
  title: string;
  url: string;
}

export interface NotebookDirectAddRequest {
  notebookUrl: string;
  source: CurrentPage;
}

export interface NotebookDirectAddTarget {
  destinationId: string;
  name: string;
  notebookUrl: string;
}

export interface NotebookDirectAddBatchRequest {
  source: CurrentPage;
  targets: NotebookDirectAddTarget[];
}

export interface NotebookCreateRequest {
  title: string;
  emoji?: string;
  source: CurrentPage;
  authuser?: string;
}

export interface NotebookCreateResult {
  ok: boolean;
  notebookId: string;
  notebookUrl: string;
  title: string;
  source: CurrentPage;
  message: string;
  checkedAt: string;
}

export interface NotebookDailyAddRequest {
  source: CurrentPage;
  authuser?: string;
}

export interface NotebookDailyAddResult {
  ok: boolean;
  notebookId: string;
  notebookUrl: string;
  title: string;
  source: CurrentPage;
  created: boolean;
  message: string;
  checkedAt: string;
}

export interface NotebookListRequest {
  authuser?: string;
}

export interface NotebookListResult {
  ok: boolean;
  notebooks: NotebookListItem[];
  message: string;
  checkedAt: string;
}

export interface NotebookListItem {
  notebookId: string;
  title: string;
  emoji?: string;
  notebookUrl: string;
  updatedAtMs?: number;
}

export interface NotebookDirectAddResult {
  ok: boolean;
  notebookUrl: string;
  notebookId?: string;
  source: CurrentPage;
  tokens: {
    at: boolean;
    bl: boolean;
  };
  rpc: {
    attempted: boolean;
    ok: boolean;
    status?: number;
    responseReceived?: boolean;
    responseKind?: NotebookDirectAddResponseKind;
    error?: string;
  };
  failure?: NotebookDirectAddFailure;
  message: string;
  checkedAt: string;
}

export interface NotebookDirectAddBatchResult {
  ok: boolean;
  source: CurrentPage;
  attemptedCount: number;
  message: string;
  checkedAt: string;
}

export type NotebookDirectAddResponseKind =
  | "not-attempted"
  | "success"
  | "empty-response"
  | "parse-error"
  | "rpc-row-missing"
  | "rpc-data-empty"
  | "rpc-data-invalid"
  | "request-error";

export interface NotebookDirectAddFailure {
  code:
    | "token-missing"
    | "login-or-permission"
    | "rate-limited"
    | "server-error"
    | "notebooklm-response-changed"
    | "source-rejected"
    | "request-error"
    | "unknown";
  title: string;
  action: string;
  diagnostic: string;
}
