import type { AppSettings, Destination } from "./types";

const STORAGE_KEY = "settings";

const DEFAULT_SETTINGS: AppSettings = {
  destinations: [],
  selectedDestinationIds: []
};

export function loadSettings(): Promise<AppSettings> {
  return new Promise((resolve) => {
    chrome.storage.sync.get({ [STORAGE_KEY]: DEFAULT_SETTINGS }, (items) => {
      resolve(normalizeSettings(items[STORAGE_KEY]));
    });
  });
}

export function saveSettings(settings: AppSettings): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.sync.set({ [STORAGE_KEY]: normalizeSettings(settings) }, () => {
      resolve();
    });
  });
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

export async function removeDestination(id: string): Promise<AppSettings> {
  const settings = await loadSettings();
  const nextSettings = {
    ...settings,
    destinations: settings.destinations.filter((destination) => destination.id !== id),
    selectedDestinationIds: settings.selectedDestinationIds.filter((destinationId) => destinationId !== id)
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
    selectedDestinationIds
  };
}

function sortDestinations(destinations: Destination[]): Destination[] {
  return [...destinations].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
