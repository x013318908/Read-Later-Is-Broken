import "../styles/app.css";
import {
  loadSettings,
  rememberPopupTargetSettings,
  rememberSelectedDestinations,
  replaceDestinations
} from "../shared/storage";
import type {
  AppSettings,
  CurrentPage,
  DateNotebookPeriod,
  Destination,
  LastAddStatus,
  NotebookAddJobResult,
  NotebookListResult
} from "../shared/types";

const state: {
  settings: AppSettings;
  currentPage?: CurrentPage;
  searchQuery: string;
} = {
  settings: {
    destinations: [],
    selectedDestinationIds: [],
    dailyDestinationEnabled: false,
    weeklyDestinationEnabled: false,
    monthlyDestinationEnabled: false,
    newNotebookEnabled: false
  },
  searchQuery: ""
};

const elements = {
  form: getElement<HTMLFormElement>("send-form"),
  destinationSearch: getElement<HTMLInputElement>("destination-search"),
  refreshNotebooksButton: getElement<HTMLButtonElement>("refresh-notebooks-button"),
  destinationList: getElement<HTMLDivElement>("destination-list"),
  dailyDestinationEnabled: getElement<HTMLInputElement>("daily-destination-enabled"),
  dailyTitle: getElement<HTMLElement>("daily-title"),
  weeklyDestinationEnabled: getElement<HTMLInputElement>("weekly-destination-enabled"),
  weeklyTitle: getElement<HTMLElement>("weekly-title"),
  monthlyDestinationEnabled: getElement<HTMLInputElement>("monthly-destination-enabled"),
  monthlyTitle: getElement<HTMLElement>("monthly-title"),
  newNotebookEnabled: getElement<HTMLInputElement>("new-notebook-enabled"),
  newTitle: getElement<HTMLInputElement>("new-title"),
  sendButton: getElement<HTMLButtonElement>("send-button"),
  message: getElement<HTMLParagraphElement>("message"),
  lastResult: getElement<HTMLParagraphElement>("last-result")
};

document.addEventListener("DOMContentLoaded", () => {
  void initialize();
});

async function initialize(): Promise<void> {
  applyDateNotebookTitles();

  elements.form.addEventListener("submit", (event) => {
    event.preventDefault();
    void handleSubmit();
  });

  elements.refreshNotebooksButton.addEventListener("click", () => {
    void refreshNotebookList();
  });

  elements.destinationSearch.addEventListener("input", () => {
    state.searchQuery = elements.destinationSearch.value;
    renderDestinations(state.settings);
  });

  [
    elements.dailyDestinationEnabled,
    elements.weeklyDestinationEnabled,
    elements.monthlyDestinationEnabled,
    elements.newNotebookEnabled
  ].forEach((input) => {
    input.addEventListener("change", () => {
      void rememberTargetSettingsFromForm();
      updateControlState();
      updateSendButtonLabel();
    });
  });

  try {
    const settings = await loadSettings();
    state.settings = settings;
    renderDestinations(settings);
    renderLastAddStatus(settings.lastAddStatus);

    if (settings.destinations.length === 0) {
      await refreshNotebookList({ auto: true });
    }
  } catch (error) {
    showMessage(getErrorMessage(error), "danger");
  }

  try {
    const currentPage = await getCurrentPage();
    state.currentPage = currentPage;
    applyCurrentPage(currentPage);
  } catch (error) {
    showMessage(`現在のページを取得できませんでした。${getErrorMessage(error)}`, "danger");
    elements.sendButton.disabled = true;
  }
}

async function refreshNotebookList(options: { auto?: boolean } = {}): Promise<void> {
  elements.refreshNotebooksButton.disabled = true;
  showMessage(
    options.auto
      ? "NotebookLMのノートブック一覧を読み込んでいます。"
      : "NotebookLMのノートブック一覧を更新しています。",
    "neutral"
  );

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

    state.settings = await replaceDestinations(
      response.result.notebooks.map((notebook) => ({
        name: formatNotebookName(notebook),
        notebookUrl: notebook.notebookUrl
      }))
    );
    renderDestinations(state.settings);
    showMessage(`NotebookLMから${response.result.notebooks.length}件を読み込みました。`, "neutral");
  } catch (error) {
    showMessage(getErrorMessage(error), "danger");
  } finally {
    elements.refreshNotebooksButton.disabled = false;
  }
}

async function handleSubmit(): Promise<void> {
  if (!state.currentPage) {
    showMessage("現在ページが取得できていません。", "danger");
    return;
  }

  const destinations = getSelectedDestinations();
  const dateNotebookPeriods = getEnabledDateNotebookPeriods();
  const newNotebookEnabled = elements.newNotebookEnabled.checked;

  if (destinations.length === 0 && dateNotebookPeriods.length === 0 && !newNotebookEnabled) {
    showMessage("追加先を1つ以上選択してください。", "danger");
    return;
  }

  elements.sendButton.disabled = true;

  try {
    state.settings = await rememberSelectedDestinations(getSelectedDestinationIdsFromForm());
    state.settings = await rememberTargetSettingsFromForm();
    showMessage("NotebookLMへの追加を開始しました。popupを閉じても続行します。", "neutral");
    const response = await chrome.runtime.sendMessage({
      type: "runNotebookAddJob",
      payload: {
        source: state.currentPage,
        existingTargets: destinations.map((destination) => ({
          destinationId: destination.id,
          name: destination.name,
          notebookUrl: destination.notebookUrl
        })),
        datePeriods: dateNotebookPeriods,
        newNotebookTitle: newNotebookEnabled ? elements.newTitle.value : undefined
      }
    });

    if (!isAddJobResponse(response)) {
      throw new Error("NotebookLM追加結果を取得できませんでした。");
    }

    if (!response.ok) {
      throw new Error(response.error);
    }

    state.settings = await loadSettings();
    renderDestinations(state.settings);
    renderLastAddStatus(response.result.status);
    showMessage(response.result.status.message, getStatusMessageVariant(response.result.status));
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

function applyCurrentPage(currentPage: CurrentPage): void {
  elements.newTitle.value = currentPage.title;
  applyDateNotebookTitles();
}

function renderDestinations(settings: AppSettings): void {
  elements.destinationList.replaceChildren();
  elements.dailyDestinationEnabled.checked = settings.dailyDestinationEnabled;
  elements.weeklyDestinationEnabled.checked = settings.weeklyDestinationEnabled;
  elements.monthlyDestinationEnabled.checked = settings.monthlyDestinationEnabled;
  elements.newNotebookEnabled.checked = settings.newNotebookEnabled;

  if (settings.destinations.length === 0) {
    const empty = document.createElement("div");
    empty.className = "destination-check-empty";
    empty.textContent = "保存先が未登録です";
    elements.destinationList.append(empty);
    updateControlState();
    updateSendButtonLabel();
    return;
  }

  const selectedIds = new Set(getInitialSelectedDestinationIds(settings));
  const visibleDestinations = getVisibleDestinations(settings.destinations, selectedIds, state.searchQuery);

  if (visibleDestinations.length === 0) {
    const empty = document.createElement("div");
    empty.className = "destination-check-empty";
    empty.textContent = "一致するノートブックはありません";
    elements.destinationList.append(empty);
    updateControlState();
    updateSendButtonLabel();
    return;
  }

  for (const destination of visibleDestinations) {
    const label = document.createElement("label");
    label.className = "destination-check-row";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = destination.id;
    checkbox.checked = selectedIds.has(destination.id);
    checkbox.addEventListener("change", () => {
      void rememberSelectionAndTargetSettingsFromForm();
      updateControlState();
      updateSendButtonLabel();
    });

    const text = document.createElement("span");

    const name = document.createElement("strong");
    name.textContent = destination.name;

    text.append(name);
    label.append(checkbox, text);
    elements.destinationList.append(label);
  }

  updateControlState();
  updateSendButtonLabel();
}

function getInitialSelectedDestinationIds(settings: AppSettings): string[] {
  const destinationIds = new Set(settings.destinations.map((destination) => destination.id));
  const selectedIds = settings.selectedDestinationIds.filter((id) => destinationIds.has(id));

  if (selectedIds.length > 0) {
    return selectedIds;
  }

  return [];
}

function getVisibleDestinations(
  destinations: Destination[],
  selectedIds: Set<string>,
  searchQuery: string
): Destination[] {
  const normalizedQuery = normalizeSearchText(searchQuery);

  if (!normalizedQuery) {
    return destinations;
  }

  return destinations.filter((destination) => {
    return selectedIds.has(destination.id) || normalizeSearchText(destination.name).includes(normalizedQuery);
  });
}

function normalizeSearchText(value: string): string {
  return value.trim().toLocaleLowerCase("ja");
}

function getSelectedDestinations(): Destination[] {
  const selectedIds = new Set(getSelectedDestinationIdsFromForm());
  return state.settings.destinations.filter((destination) => selectedIds.has(destination.id));
}

function updateSendButtonLabel(): void {
  const existingCount = getSelectedDestinationIdsFromForm().length;
  const dateNotebookCount = getEnabledDateNotebookPeriods().length;
  const newNotebookCount = elements.newNotebookEnabled.checked ? 1 : 0;
  const total = existingCount + dateNotebookCount + newNotebookCount;
  elements.sendButton.textContent = total > 0 ? `NotebookLM に追加 (${total})` : "NotebookLM に追加";
}

function getSelectedDestinationIdsFromForm(): string[] {
  return [...elements.destinationList.querySelectorAll<HTMLInputElement>("input[type='checkbox']:checked")].map(
    (input) => input.value
  );
}

async function rememberSelectionAndTargetSettingsFromForm(): Promise<void> {
  state.settings = await rememberSelectedDestinations(getSelectedDestinationIdsFromForm());
  state.settings = await rememberTargetSettingsFromForm();
}

async function rememberTargetSettingsFromForm(): Promise<AppSettings> {
  const nextSettings = await rememberPopupTargetSettings({
    dailyDestinationEnabled: elements.dailyDestinationEnabled.checked,
    weeklyDestinationEnabled: elements.weeklyDestinationEnabled.checked,
    monthlyDestinationEnabled: elements.monthlyDestinationEnabled.checked,
    newNotebookEnabled: elements.newNotebookEnabled.checked
  });
  state.settings = nextSettings;

  return nextSettings;
}

function updateControlState(): void {
  elements.newTitle.disabled = !elements.newNotebookEnabled.checked;
}

function renderLastAddStatus(status: LastAddStatus | undefined): void {
  if (!status) {
    elements.lastResult.textContent = "";
    elements.lastResult.removeAttribute("data-variant");
    return;
  }

  elements.lastResult.textContent = `前回の追加: ${status.message}`;
  elements.lastResult.dataset.variant = getStatusMessageVariant(status);
}

function getStatusMessageVariant(status: LastAddStatus): "neutral" | "success" | "danger" {
  if (status.state === "success") {
    return "success";
  }

  if (status.state === "partial" || status.state === "failure") {
    return "danger";
  }

  return "neutral";
}

function getEnabledDateNotebookPeriods(): DateNotebookPeriod[] {
  const periods: DateNotebookPeriod[] = [];

  if (elements.dailyDestinationEnabled.checked) {
    periods.push("daily");
  }

  if (elements.weeklyDestinationEnabled.checked) {
    periods.push("weekly");
  }

  if (elements.monthlyDestinationEnabled.checked) {
    periods.push("monthly");
  }

  return periods;
}

function applyDateNotebookTitles(date = new Date()): void {
  elements.dailyTitle.textContent = getDateNotebookTitle("daily", date);
  elements.weeklyTitle.textContent = getDateNotebookTitle("weekly", date);
  elements.monthlyTitle.textContent = getDateNotebookTitle("monthly", date);
}

function getDateNotebookTitle(period: DateNotebookPeriod, date = new Date()): string {
  switch (period) {
    case "daily":
      return `Daily ${formatLocalDate(date)}`;
    case "weekly":
      return `Weekly ${formatLocalIsoWeek(date)}`;
    case "monthly":
      return `Monthly ${formatLocalMonth(date)}`;
  }
}

function formatLocalDate(date: Date): string {
  const year = date.getFullYear().toString();
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  const day = date.getDate().toString().padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function formatLocalMonth(date: Date): string {
  const year = date.getFullYear().toString();
  const month = (date.getMonth() + 1).toString().padStart(2, "0");

  return `${year}-${month}`;
}

function formatLocalIsoWeek(date: Date): string {
  const weekDate = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = weekDate.getUTCDay() || 7;
  weekDate.setUTCDate(weekDate.getUTCDate() + 4 - day);

  const isoYear = weekDate.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const days = Math.floor((weekDate.getTime() - yearStart.getTime()) / 86400000) + 1;
  const week = Math.ceil(days / 7).toString().padStart(2, "0");

  return `${isoYear}-W${week}`;
}

function formatNotebookName(notebook: NotebookListResult["notebooks"][number]): string {
  return notebook.emoji ? `${notebook.emoji} ${notebook.title}` : notebook.title;
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

function isAddJobResponse(value: unknown): value is
  | { ok: true; result: NotebookAddJobResult }
  | { ok: false; error: string } {
  if (!isRecord(value) || typeof value.ok !== "boolean") {
    return false;
  }

  return value.ok
    ? isRecord(value.result) && isLastAddStatus(value.result.status)
    : typeof value.error === "string";
}

function isLastAddStatus(value: unknown): value is LastAddStatus {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    (value.state === "running" || value.state === "success" || value.state === "partial" || value.state === "failure") &&
    typeof value.message === "string" &&
    typeof value.checkedAt === "string"
  );
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
