export const NOTEBOOKLM_HOME_URL = "https://notebooklm.google.com/";

export function normalizeNotebookUrl(value: string): string {
  const url = new URL(value.trim());

  if (url.protocol !== "https:" || url.hostname !== "notebooklm.google.com") {
    throw new Error("NotebookLM の URL を入力してください。");
  }

  return url.toString();
}
