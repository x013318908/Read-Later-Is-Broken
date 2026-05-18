import "../styles/app.css";
import { normalizeNotebookUrl } from "../shared/notebooklm";
import {
  loadLastNotebookDirectAddResult,
  loadSettings,
  removeDestination,
  upsertDestination
} from "../shared/storage";
import type { AppSettings, NotebookDirectAddResult } from "../shared/types";

const elements = {
  form: getElement<HTMLFormElement>("destination-form"),
  name: getElement<HTMLInputElement>("destination-name"),
  url: getElement<HTMLInputElement>("destination-url"),
  message: getElement<HTMLParagraphElement>("form-message"),
  emptyState: getElement<HTMLDivElement>("empty-state"),
  destinationList: getElement<HTMLUListElement>("destination-list"),
  diagnosticEmpty: getElement<HTMLDivElement>("diagnostic-empty"),
  diagnosticList: getElement<HTMLDListElement>("diagnostic-list"),
  copyDiagnosticButton: getElement<HTMLButtonElement>("copy-diagnostic-button")
};

let lastDirectAddResult: NotebookDirectAddResult | undefined;

document.addEventListener("DOMContentLoaded", () => {
  void initialize();
});

async function initialize(): Promise<void> {
  elements.form.addEventListener("submit", (event) => {
    event.preventDefault();
    void handleSubmit();
  });

  elements.copyDiagnosticButton.addEventListener("click", () => {
    void copyDiagnostic();
  });

  renderSettings(await loadSettings());
  lastDirectAddResult = await loadLastNotebookDirectAddResult();
  renderDiagnostic(lastDirectAddResult);
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

function renderDiagnostic(result: NotebookDirectAddResult | undefined): void {
  elements.diagnosticList.replaceChildren();
  elements.diagnosticEmpty.hidden = Boolean(result);
  elements.copyDiagnosticButton.hidden = !result;

  if (!result) {
    return;
  }

  const status = result.ok ? "成功" : "失敗";
  const reason = result.failure?.code ?? "none";
  const response = result.rpc.responseReceived ? "received" : result.rpc.responseKind ?? "missing";

  appendDiagnosticRow("結果", status);
  appendDiagnosticRow("理由", reason);
  appendDiagnosticRow("HTTP", result.rpc.status?.toString() ?? "n/a");
  appendDiagnosticRow("応答", response);
  appendDiagnosticRow("確認時刻", formatDateTime(result.checkedAt));
  appendDiagnosticRow("ソース", result.source.title);
  appendDiagnosticRow("URL", result.source.url);

  if (result.failure) {
    appendDiagnosticRow("対処", result.failure.action);
    appendDiagnosticRow("診断", result.failure.diagnostic);
  }
}

function appendDiagnosticRow(label: string, value: string): void {
  const term = document.createElement("dt");
  term.textContent = label;

  const detail = document.createElement("dd");
  detail.textContent = value;

  elements.diagnosticList.append(term, detail);
}

async function copyDiagnostic(): Promise<void> {
  if (!lastDirectAddResult) {
    return;
  }

  try {
    await navigator.clipboard.writeText(JSON.stringify(lastDirectAddResult, null, 2));
    showMessage("診断情報をコピーしました。", "success");
  } catch {
    showMessage("診断情報をコピーできませんでした。", "danger");
  }
}

function formatDateTime(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
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
