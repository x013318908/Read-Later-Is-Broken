import "../styles/app.css";
import { normalizeNotebookUrl } from "../shared/notebooklm";
import { loadSettings, removeDestination, upsertDestination } from "../shared/storage";
import type { AppSettings } from "../shared/types";

const elements = {
  form: getElement<HTMLFormElement>("destination-form"),
  name: getElement<HTMLInputElement>("destination-name"),
  url: getElement<HTMLInputElement>("destination-url"),
  message: getElement<HTMLParagraphElement>("form-message"),
  emptyState: getElement<HTMLDivElement>("empty-state"),
  destinationList: getElement<HTMLUListElement>("destination-list")
};

document.addEventListener("DOMContentLoaded", () => {
  void initialize();
});

async function initialize(): Promise<void> {
  elements.form.addEventListener("submit", (event) => {
    event.preventDefault();
    void handleSubmit();
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

function showMessage(message: string, variant: "success" | "danger"): void {
  elements.message.textContent = message;
  elements.message.dataset.variant = variant;
}

function getElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);

  if (!element) {
    throw new Error(`Missing element: ${id}`);
  }

  return element as T;
}
