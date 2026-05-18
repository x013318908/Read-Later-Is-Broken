import "../styles/app.css";
import { normalizeNotebookUrl } from "../shared/notebooklm";
import { addMissingDestinations, loadSettings, removeDestination, upsertDestination } from "../shared/storage";
import type { AppSettings, NotebookListResult } from "../shared/types";

const elements = {
  form: getElement<HTMLFormElement>("destination-form"),
  name: getElement<HTMLInputElement>("destination-name"),
  url: getElement<HTMLInputElement>("destination-url"),
  message: getElement<HTMLParagraphElement>("form-message"),
  emptyState: getElement<HTMLDivElement>("empty-state"),
  destinationList: getElement<HTMLUListElement>("destination-list"),
  syncNotebooksButton: getElement<HTMLButtonElement>("sync-notebooks-button")
};

document.addEventListener("DOMContentLoaded", () => {
  void initialize();
});

async function initialize(): Promise<void> {
  elements.form.addEventListener("submit", (event) => {
    event.preventDefault();
    void handleSubmit();
  });

  elements.syncNotebooksButton.addEventListener("click", () => {
    void handleNotebookSync();
  });

  renderSettings(await loadSettings());
}

async function handleSubmit(): Promise<void> {
  const name = elements.name.value.trim();

  if (!name) {
    showMessage("表示名を入力してください。", "danger");
    return;
  }

  try {
    const notebookUrl = normalizeNotebookUrl(elements.url.value);
    const settings = await upsertDestination({ name, notebookUrl });
    elements.form.reset();
    renderSettings(settings);
    showMessage("保存先を追加しました。", "success");
  } catch (error) {
    showMessage(error instanceof Error ? error.message : "保存に失敗しました。", "danger");
  }
}

async function handleNotebookSync(): Promise<void> {
  elements.syncNotebooksButton.disabled = true;
  showMessage("NotebookLMからノートブック一覧を読み込んでいます。", "neutral");

  try {
    const response = await chrome.runtime.sendMessage({
      type: "listNotebookLmNotebooks",
      payload: {}
    });

    if (!isNotebookListResponse(response)) {
      throw new Error("ノートブック一覧の取得結果を読めませんでした。");
    }

    if (!response.ok) {
      throw new Error(response.error);
    }

    const mergeResult = await addMissingDestinations(
      response.result.notebooks.map((notebook) => ({
        name: formatNotebookName(notebook),
        notebookUrl: notebook.notebookUrl
      }))
    );

    renderSettings(mergeResult.settings);
    showMessage(
      `NotebookLMから${response.result.notebooks.length}件を読み込みました。新規${mergeResult.addedCount}件を追加しました。`,
      "success"
    );
  } catch (error) {
    showMessage(error instanceof Error ? error.message : "ノートブック一覧の読み込みに失敗しました。", "danger");
  } finally {
    elements.syncNotebooksButton.disabled = false;
  }
}

function renderSettings(settings: AppSettings): void {
  elements.destinationList.replaceChildren();
  elements.emptyState.hidden = settings.destinations.length > 0;

  for (const destination of settings.destinations) {
    const item = document.createElement("li");
    item.className = "destination-item";

    const text = document.createElement("div");
    text.className = "destination-text";

    const name = document.createElement("strong");
    name.textContent = destination.name;

    const url = document.createElement("span");
    url.textContent = destination.notebookUrl;

    text.append(name, url);

    const openButton = document.createElement("button");
    openButton.type = "button";
    openButton.className = "secondary-button small";
    openButton.textContent = "開く";
    openButton.addEventListener("click", () => {
      void chrome.tabs.create({ url: destination.notebookUrl, active: true });
    });

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "danger-button small";
    deleteButton.textContent = "削除";
    deleteButton.addEventListener("click", async () => {
      const nextSettings = await removeDestination(destination.id);
      renderSettings(nextSettings);
      showMessage("保存先を削除しました。", "success");
    });

    item.append(text, openButton, deleteButton);
    elements.destinationList.append(item);
  }
}

function formatNotebookName(notebook: NotebookListResult["notebooks"][number]): string {
  return notebook.emoji ? `${notebook.emoji} ${notebook.title}` : notebook.title;
}

function showMessage(message: string, variant: "success" | "danger" | "neutral"): void {
  elements.message.textContent = message;
  if (variant === "neutral") {
    delete elements.message.dataset.variant;
    return;
  }

  elements.message.dataset.variant = variant;
}

function isNotebookListResponse(value: unknown): value is
  | { ok: true; result: NotebookListResult }
  | { ok: false; error: string } {
  if (!isRecord(value) || typeof value.ok !== "boolean") {
    return false;
  }

  return value.ok
    ? isRecord(value.result) &&
        Array.isArray(value.result.notebooks) &&
        typeof value.result.message === "string" &&
        typeof value.result.checkedAt === "string"
    : typeof value.error === "string";
}

function getElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);

  if (!element) {
    throw new Error(`Missing element: ${id}`);
  }

  return element as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
