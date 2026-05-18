import "../styles/app.css";
import { NOTEBOOKLM_HOME_URL } from "../shared/notebooklm";
import { loadSettings, rememberSelectedDestinations } from "../shared/storage";
import type { AppSettings, CurrentPage, Destination, NotebookDirectAddBatchResult } from "../shared/types";

const state: {
  settings: AppSettings;
  currentPage?: CurrentPage;
} = {
  settings: { destinations: [], selectedDestinationIds: [] }
};

const elements = {
  sourceStatus: getElement<HTMLSpanElement>("source-status"),
  pageTitle: getElement<HTMLParagraphElement>("page-title"),
  pageUrl: getElement<HTMLParagraphElement>("page-url"),
  form: getElement<HTMLFormElement>("send-form"),
  destinationList: getElement<HTMLDivElement>("destination-list"),
  newTitle: getElement<HTMLInputElement>("new-title"),
  sendButton: getElement<HTMLButtonElement>("send-button"),
  optionsButton: getElement<HTMLButtonElement>("options-button"),
  message: getElement<HTMLParagraphElement>("message")
};

document.addEventListener("DOMContentLoaded", () => {
  void initialize();
});

async function initialize(): Promise<void> {
  elements.form.addEventListener("submit", (event) => {
    event.preventDefault();
    void handleSubmit();
  });

  elements.optionsButton.addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });

  document.querySelectorAll<HTMLInputElement>("input[name='mode']").forEach((input) => {
    input.addEventListener("change", updateSendButtonLabel);
  });

  try {
    const [settings, currentPage] = await Promise.all([loadSettings(), getCurrentPage()]);
    state.settings = settings;
    state.currentPage = currentPage;
    renderCurrentPage(currentPage);
    renderDestinations(settings);
  } catch (error) {
    elements.sourceStatus.textContent = "未取得";
    elements.sourceStatus.dataset.variant = "danger";
    elements.pageTitle.textContent = "現在のページを取得できませんでした。";
    elements.pageUrl.textContent = getErrorMessage(error);
    elements.sendButton.disabled = true;
  }
}

async function handleSubmit(): Promise<void> {
  if (!state.currentPage) {
    showMessage("現在ページが取得できていません。", "danger");
    return;
  }

  const mode = getSelectedMode();
  const destinations = mode === "existing" ? getSelectedDestinations() : [];

  if (mode === "existing" && state.settings.destinations.length === 0) {
    showMessage("保存先ノートブックを登録してください。", "danger");
    chrome.runtime.openOptionsPage();
    return;
  }

  if (mode === "existing" && destinations.length === 0) {
    showMessage("追加先ノートブックを1つ以上選択してください。", "danger");
    return;
  }

  elements.sendButton.disabled = true;

  try {
    if (destinations.length > 0) {
      state.settings = await rememberSelectedDestinations(destinations.map((destination) => destination.id));
      showMessage(`NotebookLM にURLを追加しています... (${destinations.length}件)`, "neutral");
      const response = await chrome.runtime.sendMessage({
        type: "addSourcesToNotebooks",
        payload: {
          source: state.currentPage,
          targets: destinations.map((destination) => ({
            destinationId: destination.id,
            name: destination.name,
            notebookUrl: destination.notebookUrl
          }))
        }
      });

      if (!isBatchInjectionResponse(response)) {
        throw new Error("URL追加の結果を取得できませんでした。");
      }

      if (!response.ok) {
        throw new Error(response.error);
      }

      showMessage(response.result.message, "neutral");
      renderDestinations(state.settings);
      return;
    }

    showMessage("URL をコピーしています...", "neutral");
    await copyToClipboard(state.currentPage.url);

    await chrome.tabs.create({
      url: NOTEBOOKLM_HOME_URL,
      active: true
    });

    showMessage("URL をコピーして NotebookLM を開きました。", "success");
  } catch (error) {
    showMessage(getErrorMessage(error), "danger");
  } finally {
    elements.sendButton.disabled = false;
  }
}

async function getCurrentPage(): Promise<CurrentPage> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab?.url || tab.url.startsWith("chrome://") || tab.url.startsWith("edge://")) {
    throw new Error("このページは Chrome 拡張から取得できません。");
  }

  return {
    title: tab.title?.trim() || "Untitled page",
    url: tab.url
  };
}

function renderCurrentPage(currentPage: CurrentPage): void {
  elements.sourceStatus.textContent = "選択済み";
  elements.sourceStatus.dataset.variant = "ok";
  elements.pageTitle.textContent = currentPage.title;
  elements.pageUrl.textContent = currentPage.url;
  elements.newTitle.value = currentPage.title;
}

function renderDestinations(settings: AppSettings): void {
  elements.destinationList.replaceChildren();

  if (settings.destinations.length === 0) {
    const empty = document.createElement("div");
    empty.className = "destination-check-empty";
    empty.textContent = "保存先が未登録です";
    elements.destinationList.append(empty);
    selectMode("new");
    updateSendButtonLabel();
    return;
  }

  const selectedIds = getInitialSelectedDestinationIds(settings);

  for (const destination of settings.destinations) {
    const label = document.createElement("label");
    label.className = "destination-check-row";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = destination.id;
    checkbox.checked = selectedIds.includes(destination.id);
    checkbox.addEventListener("change", () => {
      void rememberSelectionFromForm();
      updateSendButtonLabel();
    });

    const text = document.createElement("span");

    const name = document.createElement("strong");
    name.textContent = destination.name;

    const url = document.createElement("small");
    url.textContent = destination.notebookUrl;

    text.append(name, url);
    label.append(checkbox, text);
    elements.destinationList.append(label);
  }

  updateSendButtonLabel();
}

function getInitialSelectedDestinationIds(settings: AppSettings): string[] {
  const destinationIds = new Set(settings.destinations.map((destination) => destination.id));
  const selectedIds = settings.selectedDestinationIds.filter((id) => destinationIds.has(id));

  if (selectedIds.length > 0) {
    return selectedIds;
  }

  return settings.destinations[0] ? [settings.destinations[0].id] : [];
}

function getSelectedMode(): "existing" | "new" {
  const selected = document.querySelector<HTMLInputElement>("input[name='mode']:checked");
  return selected?.value === "existing" ? "existing" : "new";
}

function selectMode(mode: "existing" | "new"): void {
  const input = document.querySelector<HTMLInputElement>(`input[name='mode'][value='${mode}']`);
  if (input) {
    input.checked = true;
  }
}

function getSelectedDestinations(): Destination[] {
  const selectedIds = new Set(getSelectedDestinationIdsFromForm());
  return state.settings.destinations.filter((destination) => selectedIds.has(destination.id));
}

function updateSendButtonLabel(): void {
  if (getSelectedMode() === "new") {
    elements.sendButton.textContent = "NotebookLM を開く";
    return;
  }

  const count = getSelectedDestinationIdsFromForm().length;
  elements.sendButton.textContent = count > 0 ? `NotebookLM に追加 (${count})` : "NotebookLM に追加";
}

function getSelectedDestinationIdsFromForm(): string[] {
  return [...elements.destinationList.querySelectorAll<HTMLInputElement>("input[type='checkbox']:checked")].map(
    (input) => input.value
  );
}

async function rememberSelectionFromForm(): Promise<void> {
  state.settings = await rememberSelectedDestinations(getSelectedDestinationIdsFromForm());
}

async function copyToClipboard(value: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    const textArea = document.createElement("textarea");
    textArea.value = value;
    textArea.style.position = "fixed";
    textArea.style.opacity = "0";
    document.body.append(textArea);
    textArea.select();
    document.execCommand("copy");
    textArea.remove();
  }
}

function showMessage(message: string, variant: "neutral" | "success" | "danger"): void {
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

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "予期しないエラーが発生しました。";
}

function isBatchInjectionResponse(value: unknown): value is
  | { ok: true; result: NotebookDirectAddBatchResult }
  | { ok: false; error: string } {
  if (!isRecord(value) || typeof value.ok !== "boolean") {
    return false;
  }

  return value.ok
    ? isRecord(value.result) &&
        typeof value.result.message === "string" &&
        typeof value.result.ok === "boolean" &&
        typeof value.result.attemptedCount === "number"
    : typeof value.error === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
