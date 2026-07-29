export const GEMINI_NOTEBOOK_ORIGIN = "https://notebook.google.com";
export const GEMINI_NOTEBOOK_RPC_PATH = "/_/LabsTailwindUi/data/batchexecute";

const SUPPORTED_NOTEBOOK_HOSTNAMES = new Set(["notebook.google.com", "notebooklm.google.com"]);

export interface GeminiNotebookTarget {
  notebookId: string;
  authuser?: string;
  notebookUrl: string;
}

export function buildNotebookUrl(notebookId: string, authuser?: string): string {
  const url = new URL(`/notebook/${notebookId}`, GEMINI_NOTEBOOK_ORIGIN);

  if (authuser) {
    url.searchParams.set("authuser", authuser);
  }

  return url.toString();
}

export function getNotebookTarget(notebookUrl: string): GeminiNotebookTarget | undefined {
  try {
    const url = new URL(notebookUrl);

    if (url.protocol !== "https:" || !SUPPORTED_NOTEBOOK_HOSTNAMES.has(url.hostname)) {
      return undefined;
    }

    const notebookId = /^\/notebook\/([^/?#]+)/.exec(url.pathname)?.[1];

    if (!notebookId) {
      return undefined;
    }

    const authuser = url.searchParams.get("authuser") ?? undefined;

    return {
      notebookId,
      authuser,
      notebookUrl: buildNotebookUrl(notebookId, authuser)
    };
  } catch {
    return undefined;
  }
}

export function canonicalizeNotebookUrl(notebookUrl: string): string {
  return getNotebookTarget(notebookUrl)?.notebookUrl ?? notebookUrl;
}
