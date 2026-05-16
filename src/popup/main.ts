import "../styles/app.css";
import { NOTEBOOKLM_HOME_URL } from "../shared/notebooklm";
import { loadSettings, rememberLastDestination } from "../shared/storage";
import type { AppSettings, CurrentPage, Destination } from "../shared/types";

const state: {
  settings: AppSettings;
  currentPage?: CurrentPage;
} = {
  settings: { destinations: [] }
};

const elements = {
  sourceStatus: getElement<HTMLSpanElement>("source-status"),
  pageTitle: getElement<HTMLParagraphElement>("page-title"),
  pageUrl: getElement<HTMLParagraphElement>("page-url"),
  form: getElement<HTMLFormElement>("send-form"),
  destinationSelect: getElement<HTMLSelectElement>("destination-select"),
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
  const destination = mode === "existing" ? getSelectedDestination() : undefined;

  if (mode === "existing" && !destination) {
    showMessage("保存先ノートブックを登録してください。", "danger");
    chrome.runtime.openOptionsPage();
    return;
  }

  elements.sendButton.disabled = true;
  showMessage("URL をコピーしています...", "neutral");

  try {
    await copyToClipboard(state.currentPage.url);

    if (destination) {
      await rememberLastDestination(destination.id);
    }

    await chrome.tabs.create({
      url: destination?.notebookUrl ?? NOTEBOOKLM_HOME_URL,
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
  elements.destinationSelect.replaceChildren();

  if (settings.destinations.length === 0) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "保存先が未登録です";
    elements.destinationSelect.append(option);
    elements.destinationSelect.disabled = true;
    selectMode("new");
    return;
  }

  elements.destinationSelect.disabled = false;

  for (const destination of settings.destinations) {
    const option = document.createElement("option");
    option.value = destination.id;
    option.textContent = destination.name;
    option.selected =
      destination.id === settings.lastDestinationId ||
      (!settings.lastDestinationId && destination === settings.destinations[0]);
    elements.destinationSelect.append(option);
  }
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

function getSelectedDestination(): Destination | undefined {
  return state.settings.destinations.find((destination) => destination.id === elements.destinationSelect.value);
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
