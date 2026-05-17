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
  };
  message: string;
  checkedAt: string;
}
