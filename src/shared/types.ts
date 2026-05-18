export interface Destination {
  id: string;
  name: string;
  notebookUrl: string;
  createdAt: string;
  updatedAt: string;
}

export interface AppSettings {
  destinations: Destination[];
  lastDestinationId?: string;
}

export interface CurrentPage {
  title: string;
  url: string;
}

export interface NotebookDirectAddRequest {
  notebookUrl: string;
  source: CurrentPage;
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
