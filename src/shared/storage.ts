import type { AddJobStatusItem, AppSettings, CurrentPage, Destination, LastAddStatus } from "./types";

const STORAGE_KEY = "settings";

const DEFAULT_SETTINGS: AppSettings = {
  destinations: [],
  selectedDestinationIds: [],
  dailyDestinationEnabled: false,
  weeklyDestinationEnabled: false,
  monthlyDestinationEnabled: false,
  newNotebookEnabled: false
};

export function loadSettings(): Promise<AppSettings> {
  return loadSettingsFromStorage();
}

export function saveSettings(settings: AppSettings): Promise<void> {
  return setStorageValue(chrome.storage.local, normalizeSettings(settings));
}

export async function upsertDestination(input: Pick<Destination, "name" | "notebookUrl">): Promise<AppSettings> {
  const settings = await loadSettings();
  const now = new Date().toISOString();
  const existing = settings.destinations.find((destination) => destination.notebookUrl === input.notebookUrl);

  const destinations = existing
    ? settings.destinations.map((destination) =>
        destination.id === existing.id
          ? { ...destination, name: input.name, updatedAt: now }
          : destination
      )
    : [
        ...settings.destinations,
        {
          id: crypto.randomUUID(),
          name: input.name,
          notebookUrl: input.notebookUrl,
          createdAt: now,
          updatedAt: now
        }
      ];

  const nextSettings = {
    ...settings,
    destinations: sortDestinations(destinations)
  };

  await saveSettings(nextSettings);
  return nextSettings;
}

export async function replaceDestinations(inputs: Array<Pick<Destination, "name" | "notebookUrl">>): Promise<AppSettings> {
  const settings = await loadSettings();
  const now = new Date().toISOString();
  const existingByUrl = new Map(
    settings.destinations.map((destination) => [destination.notebookUrl, destination])
  );
  const destinationUrls = new Set<string>();
  const destinations: Destination[] = [];

  for (const input of inputs) {
    if (destinationUrls.has(input.notebookUrl)) {
      continue;
    }

    destinationUrls.add(input.notebookUrl);
    const existing = existingByUrl.get(input.notebookUrl);
    destinations.push(
      existing
        ? {
            ...existing,
            name: input.name,
            updatedAt: existing.name === input.name ? existing.updatedAt : now
          }
        : {
            id: crypto.randomUUID(),
            name: input.name,
            notebookUrl: input.notebookUrl,
            createdAt: now,
            updatedAt: now
          }
    );
  }

  const destinationIds = new Set(destinations.map((destination) => destination.id));
  const nextSettings = {
    ...settings,
    destinations: sortDestinations(destinations),
    selectedDestinationIds: settings.selectedDestinationIds.filter((destinationId) =>
      destinationIds.has(destinationId)
    )
  };

  await saveSettings(nextSettings);
  return nextSettings;
}

export async function rememberSelectedDestinations(ids: string[]): Promise<AppSettings> {
  const settings = await loadSettings();
  const destinationIds = new Set(settings.destinations.map((destination) => destination.id));
  const selectedDestinationIds = ids.filter((id, index) => destinationIds.has(id) && ids.indexOf(id) === index);
  const nextSettings = { ...settings, selectedDestinationIds };

  await saveSettings(nextSettings);
  return nextSettings;
}

export async function rememberPopupTargetSettings(
  input: Pick<
    AppSettings,
    "dailyDestinationEnabled" | "weeklyDestinationEnabled" | "monthlyDestinationEnabled" | "newNotebookEnabled"
  >
): Promise<AppSettings> {
  const settings = await loadSettings();
  const nextSettings = {
    ...settings,
    dailyDestinationEnabled: input.dailyDestinationEnabled,
    weeklyDestinationEnabled: input.weeklyDestinationEnabled,
    monthlyDestinationEnabled: input.monthlyDestinationEnabled,
    newNotebookEnabled: input.newNotebookEnabled
  };

  await saveSettings(nextSettings);
  return nextSettings;
}

export async function rememberLastAddStatus(lastAddStatus: LastAddStatus): Promise<AppSettings> {
  const settings = await loadSettings();
  const nextSettings = {
    ...settings,
    lastAddStatus
  };

  await saveSettings(nextSettings);
  return nextSettings;
}

function normalizeSettings(value: unknown): AppSettings {
  if (!isRecord(value)) {
    return DEFAULT_SETTINGS;
  }

  const destinations = Array.isArray(value.destinations)
    ? value.destinations.filter(isDestination)
    : [];

  const destinationIds = new Set(destinations.map((destination) => destination.id));
  const rawSelectedDestinationIds = value.selectedDestinationIds;
  const selectedDestinationIds = Array.isArray(rawSelectedDestinationIds)
    ? rawSelectedDestinationIds.filter(
        (id, index) =>
          typeof id === "string" &&
          destinationIds.has(id) &&
          rawSelectedDestinationIds.indexOf(id) === index
      )
    : [];

  return {
    destinations: sortDestinations(destinations),
    selectedDestinationIds,
    dailyDestinationEnabled: value.dailyDestinationEnabled === true,
    weeklyDestinationEnabled: value.weeklyDestinationEnabled === true,
    monthlyDestinationEnabled: value.monthlyDestinationEnabled === true,
    newNotebookEnabled: value.newNotebookEnabled === true,
    ...(isLastAddStatus(value.lastAddStatus) ? { lastAddStatus: value.lastAddStatus } : {})
  };
}

async function loadSettingsFromStorage(): Promise<AppSettings> {
  const localSettings = await getStorageValue(chrome.storage.local);

  if (localSettings !== undefined) {
    return normalizeSettings(localSettings);
  }

  const syncSettings = await getStorageValue(chrome.storage.sync);
  const settings = normalizeSettings(syncSettings);

  await saveSettings(settings);
  return settings;
}

function getStorageValue(area: chrome.storage.StorageArea): Promise<unknown | undefined> {
  return new Promise((resolve, reject) => {
    area.get(STORAGE_KEY, (items) => {
      const error = chrome.runtime.lastError;

      if (error) {
        reject(new Error(error.message));
        return;
      }

      resolve(items[STORAGE_KEY]);
    });
  });
}

function setStorageValue(area: chrome.storage.StorageArea, settings: AppSettings): Promise<void> {
  return new Promise((resolve, reject) => {
    area.set({ [STORAGE_KEY]: settings }, () => {
      const error = chrome.runtime.lastError;

      if (error) {
        reject(new Error(error.message));
        return;
      }

      resolve();
    });
  });
}

function sortDestinations(destinations: Destination[]): Destination[] {
  return [...destinations].sort(compareDestinations);
}

function compareDestinations(a: Destination, b: Destination): number {
  const nameComparison = a.name.localeCompare(b.name, "ja", {
    numeric: true,
    sensitivity: "base"
  });

  if (nameComparison !== 0) {
    return nameComparison;
  }

  return a.notebookUrl.localeCompare(b.notebookUrl);
}

function isDestination(value: unknown): value is Destination {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.notebookUrl === "string" &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string"
  );
}

function isLastAddStatus(value: unknown): value is LastAddStatus {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    isLastAddState(value.state) &&
    isCurrentPage(value.source) &&
    typeof value.startedAt === "string" &&
    typeof value.checkedAt === "string" &&
    typeof value.message === "string" &&
    Array.isArray(value.items) &&
    value.items.every(isAddJobStatusItem)
  );
}

function isLastAddState(value: unknown): value is LastAddStatus["state"] {
  return value === "running" || value === "success" || value === "partial" || value === "failure";
}

function isAddJobStatusItem(value: unknown): value is AddJobStatusItem {
  return (
    isRecord(value) &&
    isAddJobTargetKind(value.kind) &&
    typeof value.name === "string" &&
    typeof value.ok === "boolean" &&
    typeof value.message === "string" &&
    (value.notebookUrl === undefined || typeof value.notebookUrl === "string")
  );
}

function isAddJobTargetKind(value: unknown): value is AddJobStatusItem["kind"] {
  return value === "existing" || value === "daily" || value === "weekly" || value === "monthly" || value === "new";
}

function isCurrentPage(value: unknown): value is CurrentPage {
  return isRecord(value) && typeof value.title === "string" && typeof value.url === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
