import "../styles/app.css";
import {
  loadSettings,
  rememberPopupTargetSettings,
  rememberSelectedDestinations,
  replaceDestinations,
  upsertDestination
} from "../shared/storage";
import { applyDocumentI18n, getUiLanguage, t } from "../shared/i18n";
import type {
  AppSettings,
  CurrentPage,
  DateNotebookPeriod,
  Destination,
  LastAddStatus,
  NotebookAddJobResult,
  NotebookCreateResult,
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
    monthlyDestinationEnabled: false
  },
  searchQuery: ""
};

const sortLocale = getUiLanguage();

const elements = {
  digestForm: getElement<HTMLFormElement>("digest-form"),
  themeForm: getElement<HTMLFormElement>("theme-form"),
  destinationSearch: getElement<HTMLInputElement>("destination-search"),
  refreshNotebooksButton: getElement<HTMLButtonElement>("refresh-notebooks-button"),
  destinationList: getElement<HTMLDivElement>("destination-list"),
  destinationCount: getElement<HTMLDivElement>("destination-count"),
  dailyDestinationEnabled: getElement<HTMLInputElement>("daily-destination-enabled"),
  dailyTitle: getElement<HTMLElement>("daily-title"),
  weeklyDestinationEnabled: getElement<HTMLInputElement>("weekly-destination-enabled"),
  weeklyTitle: getElement<HTMLElement>("weekly-title"),
  monthlyDestinationEnabled: getElement<HTMLInputElement>("monthly-destination-enabled"),
  monthlyTitle: getElement<HTMLElement>("monthly-title"),
  createNotebookButton: getElement<HTMLButtonElement>("create-notebook-button"),
  sendButton: getElement<HTMLButtonElement>("send-button"),
  themeSendButton: getElement<HTMLButtonElement>("theme-send-button"),
  message: getElement<HTMLParagraphElement>("message"),
  lastResult: getElement<HTMLParagraphElement>("last-result")
};

document.addEventListener("DOMContentLoaded", () => {
  void initialize();
});

async function initialize(): Promise<void> {
  document.documentElement.lang = sortLocale;
  applyDocumentI18n();
  applyDateNotebookTitles();

  elements.digestForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void handleDigestSubmit();
  });

  elements.themeForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void handleThemeSubmit();
  });

  elements.refreshNotebooksButton.addEventListener("click", () => {
    void refreshNotebookList();
  });

  elements.createNotebookButton.addEventListener("click", () => {
    void handleCreateNotebook();
  });

  elements.destinationSearch.addEventListener("input", () => {
    state.searchQuery = elements.destinationSearch.value;
    renderDestinations(state.settings, { selectedFirst: true });
  });

  [
    elements.dailyDestinationEnabled,
    elements.weeklyDestinationEnabled,
    elements.monthlyDestinationEnabled
  ].forEach((input) => {
    input.addEventListener("change", () => {
      void rememberTargetSettingsFromForm();
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
  } catch (error) {
    showMessage(t("currentPageUnavailable", [getErrorMessage(error)]), "danger");
    setSendButtonsDisabled(true);
  }
}

async function refreshNotebookList(options: {
  auto?: boolean;
  preserveDestinations?: Destination[];
  startMessage?: string;
  completeMessage?: string;
} = {}): Promise<void> {
  elements.refreshNotebooksButton.disabled = true;
  showMessage(
    options.startMessage ??
      (options.auto
        ? t("loadingNotebookList")
        : t("refreshingNotebookList")),
    "neutral"
  );

  try {
    const result = await syncNotebookList(options.preserveDestinations ?? []);
    state.settings = result.settings;
    renderDestinations(state.settings, { selectedFirst: true });
    showMessage(options.completeMessage ?? t("loadedNotebookList", [String(result.notebookCount)]), "neutral");
  } catch (error) {
    showMessage(getErrorMessage(error), "danger");
  } finally {
    elements.refreshNotebooksButton.disabled = false;
  }
}

async function syncNotebookList(preserveDestinations: Destination[] = []): Promise<{
  settings: AppSettings;
  notebookCount: number;
}> {
  const response = await chrome.runtime.sendMessage({
    type: "listNotebookLmNotebooks",
    payload: {}
  });

  if (!isNotebookListResponse(response)) {
    throw new Error(t("notebookListUnreadable"));
  }

  if (!response.ok) {
    throw new Error(response.error);
  }

  const notebookInputs = response.result.notebooks.map((notebook) => ({
    name: formatNotebookName(notebook),
    notebookUrl: notebook.notebookUrl
  }));
  const notebookUrls = new Set(notebookInputs.map((notebook) => notebook.notebookUrl));

  for (const destination of preserveDestinations) {
    if (!notebookUrls.has(destination.notebookUrl)) {
      notebookInputs.push({
        name: destination.name,
        notebookUrl: destination.notebookUrl
      });
    }
  }

  return {
    settings: await replaceDestinations(notebookInputs),
    notebookCount: response.result.notebooks.length
  };
}

async function handleDigestSubmit(): Promise<void> {
  if (!state.currentPage) {
    showMessage(t("currentPageNotReady"), "danger");
    return;
  }

  const dateNotebookPeriods = getEnabledDateNotebookPeriods();

  if (dateNotebookPeriods.length === 0) {
    showMessage(t("selectDigestDestination"), "danger");
    return;
  }

  await runNotebookAddJob({
    startMessage: t("digestJobStarted"),
    existingTargets: [],
    datePeriods: dateNotebookPeriods
  });
}

async function handleThemeSubmit(): Promise<void> {
  if (!state.currentPage) {
    showMessage(t("currentPageNotReady"), "danger");
    return;
  }

  const destinations = getSelectedDestinations();

  if (destinations.length === 0) {
    showMessage(t("selectThemeDestination"), "danger");
    return;
  }

  await runNotebookAddJob({
    startMessage: t("themeJobStarted"),
    existingTargets: destinations.map((destination) => ({
      destinationId: destination.id,
      name: destination.name,
      notebookUrl: destination.notebookUrl
    })),
    datePeriods: []
  });
}

async function handleCreateNotebook(): Promise<void> {
  const title = elements.destinationSearch.value;
  const selectedIds = getSelectedDestinationIdsFromForm();

  elements.createNotebookButton.disabled = true;
  elements.refreshNotebooksButton.disabled = true;
  showMessage(t("creatingNotebook"), "neutral");

  try {
    const response = await chrome.runtime.sendMessage({
      type: "createNotebookLmNotebook",
      payload: {
        title
      }
    });

    if (!isNotebookCreateResponse(response)) {
      throw new Error(t("createNotebookResultUnreadable"));
    }

    if (!response.ok) {
      throw new Error(response.error);
    }

    const optimisticSettings = await upsertDestination({
      name: getNewNotebookDisplayName(response.result.title),
      notebookUrl: response.result.notebookUrl
    });
    const createdDestination = optimisticSettings.destinations.find(
      (destination) => destination.notebookUrl === response.result.notebookUrl
    );

    state.settings = createdDestination
      ? await rememberSelectedDestinations([...selectedIds, createdDestination.id])
      : optimisticSettings;
    renderDestinations(state.settings, { selectedFirst: true });
    showMessage(t("notebookCreatedRefreshing"), "neutral");

    if (createdDestination) {
      try {
        const result = await syncNotebookList([createdDestination]);
        state.settings = result.settings;
        renderDestinations(state.settings, { selectedFirst: true });
        showMessage(t("notebookCreated"), "success");
      } catch (error) {
        showMessage(t("notebookCreatedRefreshFailed", [getErrorMessage(error)]), "danger");
      }
    }
  } catch (error) {
    showMessage(getErrorMessage(error), "danger");
  } finally {
    elements.createNotebookButton.disabled = false;
    elements.refreshNotebooksButton.disabled = false;
  }
}

async function runNotebookAddJob(input: {
  startMessage: string;
  existingTargets: Array<{ destinationId: string; name: string; notebookUrl: string }>;
  datePeriods: DateNotebookPeriod[];
}): Promise<void> {
  try {
    setSendButtonsDisabled(true);
    state.settings = await rememberSelectedDestinations(getSelectedDestinationIdsFromForm());
    state.settings = await rememberTargetSettingsFromForm();
    showMessage(input.startMessage, "neutral");
    const response = await chrome.runtime.sendMessage({
      type: "runNotebookAddJob",
      payload: {
        source: state.currentPage,
        existingTargets: input.existingTargets,
        datePeriods: input.datePeriods
      }
    });

    if (!isAddJobResponse(response)) {
      throw new Error(t("notebookAddResultUnreadable"));
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
    setSendButtonsDisabled(false);
  }
}

async function getCurrentPage(): Promise<CurrentPage> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab?.url || tab.url.startsWith("chrome://") || tab.url.startsWith("edge://")) {
    throw new Error(t("unsupportedCurrentPage"));
  }

  return {
    title: tab.title?.trim() || "Untitled page",
    url: tab.url
  };
}

function renderDestinations(settings: AppSettings, options: { selectedFirst?: boolean } = {}): void {
  elements.destinationList.replaceChildren();
  elements.destinationCount.textContent = t("notebookCount", [String(settings.destinations.length)]);
  elements.dailyDestinationEnabled.checked = settings.dailyDestinationEnabled;
  elements.weeklyDestinationEnabled.checked = settings.weeklyDestinationEnabled;
  elements.monthlyDestinationEnabled.checked = settings.monthlyDestinationEnabled;

  if (settings.destinations.length === 0) {
    const empty = document.createElement("div");
    empty.className = "destination-check-empty";
    empty.textContent = t("emptyDestinationList");
    elements.destinationList.append(empty);
    updateSendButtonLabel();
    return;
  }

  const selectedIds = new Set(getInitialSelectedDestinationIds(settings));
  const visibleDestinations = getVisibleDestinations(
    settings.destinations,
    selectedIds,
    state.searchQuery,
    options.selectedFirst === true
  );

  if (visibleDestinations.length === 0) {
    const empty = document.createElement("div");
    empty.className = "destination-check-empty";
    empty.textContent = t("noMatchingNotebooks");
    elements.destinationList.append(empty);
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
      updateSendButtonLabel();
    });

    const text = document.createElement("span");

    const name = document.createElement("strong");
    name.textContent = destination.name;

    text.append(name);
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

  return [];
}

function getVisibleDestinations(
  destinations: Destination[],
  selectedIds: Set<string>,
  searchQuery: string,
  selectedFirst: boolean
): Destination[] {
  const normalizedQuery = normalizeSearchText(searchQuery);
  const visibleDestinations = normalizedQuery
    ? destinations.filter((destination) => {
        return selectedIds.has(destination.id) || normalizeSearchText(destination.name).includes(normalizedQuery);
      })
    : destinations;

  return selectedFirst ? sortDestinationsForDisplay(visibleDestinations, selectedIds) : visibleDestinations;
}

function sortDestinationsForDisplay(destinations: Destination[], selectedIds: Set<string>): Destination[] {
  return [...destinations].sort((a, b) => {
    const selectedComparison = Number(selectedIds.has(b.id)) - Number(selectedIds.has(a.id));

    if (selectedComparison !== 0) {
      return selectedComparison;
    }

    const nameComparison = a.name.localeCompare(b.name, sortLocale, {
      numeric: true,
      sensitivity: "base"
    });

    if (nameComparison !== 0) {
      return nameComparison;
    }

    return a.notebookUrl.localeCompare(b.notebookUrl);
  });
}

function normalizeSearchText(value: string): string {
  return value.trim().toLocaleLowerCase(sortLocale);
}

function getSelectedDestinations(): Destination[] {
  const selectedIds = new Set(getSelectedDestinationIdsFromForm());
  return state.settings.destinations.filter((destination) => selectedIds.has(destination.id));
}

function updateSendButtonLabel(): void {
  const existingCount = getSelectedDestinationIdsFromForm().length;
  const dateNotebookCount = getEnabledDateNotebookPeriods().length;
  elements.sendButton.textContent =
    dateNotebookCount > 0 ? t("addToNotebookLmWithCount", [String(dateNotebookCount)]) : t("addToNotebookLm");
  elements.themeSendButton.textContent =
    existingCount > 0 ? t("addToNotebookLmWithCount", [String(existingCount)]) : t("addToNotebookLm");
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
    monthlyDestinationEnabled: elements.monthlyDestinationEnabled.checked
  });
  state.settings = nextSettings;

  return nextSettings;
}

function setSendButtonsDisabled(disabled: boolean): void {
  elements.sendButton.disabled = disabled;
  elements.themeSendButton.disabled = disabled;
}

function renderLastAddStatus(status: LastAddStatus | undefined): void {
  if (!status) {
    elements.lastResult.textContent = "";
    elements.lastResult.removeAttribute("data-variant");
    return;
  }

  elements.lastResult.textContent = t("lastAddResult", [status.message]);
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

function getNewNotebookDisplayName(title: string): string {
  return title.trim() || t("newNotebookFallbackName");
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
  return error instanceof Error ? error.message : t("unexpectedError");
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

function isNotebookCreateResponse(value: unknown): value is
  | { ok: true; result: NotebookCreateResult }
  | { ok: false; error: string } {
  if (!isRecord(value) || typeof value.ok !== "boolean") {
    return false;
  }

  return value.ok
    ? isRecord(value.result) &&
        typeof value.result.ok === "boolean" &&
        typeof value.result.notebookId === "string" &&
        typeof value.result.notebookUrl === "string" &&
        typeof value.result.title === "string" &&
        typeof value.result.message === "string" &&
        typeof value.result.checkedAt === "string"
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
