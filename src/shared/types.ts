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
