import { getNotebookTarget } from "../shared/geminiNotebook";
import { t } from "../shared/i18n";
import { isNewNotebookAddStatus, NEW_NOTEBOOK_ADD_STATUS_KEY } from "../shared/storage";
import type { CurrentPage, NewNotebookAddStatus } from "../shared/types";
import { resetButtonFeedback, setButtonLabel, startButtonFeedback } from "./buttonFeedback";

export function initializeNewNotebookControls(options: {
  getCurrentPage: () => CurrentPage | undefined;
  getNotebookName: (notebookUrl: string) => string | undefined;
  onComplete: (status: NewNotebookAddStatus) => Promise<void>;
}): {
  restoreStatus: (status: NewNotebookAddStatus | undefined) => void;
  updateAvailability: () => void;
  updateNotebookLink: () => void;
} {
  const form = getElement<HTMLFormElement>("new-notebook-form");
  const button = getElement<HTMLButtonElement>("new-notebook-button");
  const message = getElement<HTMLParagraphElement>("new-notebook-status");
  const actions = getElement<HTMLDivElement>("new-notebook-actions");
  const openLink = getElement<HTMLAnchorElement>("new-notebook-open-link");
  const retryButton = getElement<HTMLButtonElement>("new-notebook-retry-button");
  let status: NewNotebookAddStatus | undefined;
  let settingsReady = false;
  let requestPending = false;
  let previousStatusId: string | undefined;
  let completedStatusId: string | undefined;
  let activeButton = button;
  let finishFeedback: ReturnType<typeof startButtonFeedback> | undefined;

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!button.disabled) {
      void run(false);
    }
  });
  retryButton.addEventListener("click", () => {
    if (!retryButton.disabled) {
      void run(true);
    }
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    const nextStatus: unknown = changes[NEW_NOTEBOOK_ADD_STATUS_KEY]?.newValue;
    if (area !== "local" || !isNewNotebookAddStatus(nextStatus)) {
      return;
    }
    if (requestPending && nextStatus.id === previousStatusId) {
      return;
    }
    applyStatus(nextStatus);
  });

  function updateAvailability(): void {
    const running = requestPending || status?.state === "running";
    button.disabled = running || !settingsReady || !options.getCurrentPage();
    retryButton.disabled = running;
  }

  function updateNotebookLink(): void {
    const notebookTarget = status?.notebookUrl ? getNotebookTarget(status.notebookUrl) : undefined;
    const notebookName = notebookTarget ? options.getNotebookName(notebookTarget.notebookUrl)?.trim() : undefined;
    const displayName = notebookName &&
      notebookName !== t("newNotebookFallbackName") &&
      notebookName !== t("untitledNotebook")
      ? notebookName
      : undefined;
    const openLabel = displayName ? t("openNotebook", [displayName]) : t("openCreatedNotebook");
    openLink.textContent = displayName ?? openLabel;
    openLink.title = openLabel;
    openLink.setAttribute("aria-label", openLabel);
    if (notebookTarget) {
      openLink.href = notebookTarget.notebookUrl;
    } else {
      openLink.removeAttribute("href");
    }
  }

  function render(): void {
    const running = status?.state === "running";
    message.hidden = !status;
    message.textContent = status?.message ?? "";
    message.dataset.variant = running ? "neutral" : status?.state === "success" ? "success" : "danger";
    const notebookTarget = status?.notebookUrl ? getNotebookTarget(status.notebookUrl) : undefined;
    actions.hidden = !notebookTarget;
    updateNotebookLink();
    retryButton.hidden = !notebookTarget || (status?.state !== "failure" && !(running && activeButton === retryButton));

    if (running && !finishFeedback) {
      finishFeedback = startButtonFeedback(activeButton, () =>
        t(status?.phase === "adding" ? "buttonAdding" : "buttonCreating")
      );
    } else if (!running && finishFeedback) {
      finishFeedback({
        variant: status?.state === "success" ? "success" : "danger",
        label: t(status?.state === "success" ? "buttonAdded" : status?.notebookUrl ? "buttonAddFailed" : "buttonCreateFailed")
      });
      finishFeedback = undefined;
    }
    setButtonLabel(button, t("createAndAddPage"));
    setButtonLabel(retryButton, t("retryPageAdd"));
    updateAvailability();
  }

  function applyStatus(nextStatus: NewNotebookAddStatus): void {
    status = nextStatus;
    render();
    if (status.state !== "running" && status.notebookUrl && completedStatusId !== status.id) {
      completedStatusId = status.id;
      void options.onComplete(status).catch((error: unknown) => {
        console.warn("Read Later Is Broken: new notebook list refresh failed.", error);
      });
    }
  }

  async function run(retry: boolean): Promise<void> {
    const source = retry ? status?.source : options.getCurrentPage();
    const notebookUrl = retry ? status?.notebookUrl : undefined;
    if (!source || (retry && !notebookUrl)) {
      return;
    }

    previousStatusId = status?.id;
    requestPending = true;
    activeButton = retry ? retryButton : button;
    resetButtonFeedback(retry ? button : retryButton);
    const startedAt = new Date().toISOString();
    status = {
      id: crypto.randomUUID(),
      state: "running",
      phase: retry ? "adding" : "creating",
      source,
      ...(notebookUrl ? { notebookUrl } : {}),
      startedAt,
      checkedAt: startedAt,
      message: t(retry ? "newNotebookAdding" : "newNotebookCreating")
    };
    render();

    try {
      const nextStatus = await sendNewNotebookAdd({ source, ...(notebookUrl ? { notebookUrl } : {}) });
      applyStatus(nextStatus);
    } catch (error) {
      status = { ...status, state: "failure", message: error instanceof Error ? error.message : t("unexpectedError") };
      render();
    } finally {
      requestPending = false;
      updateAvailability();
    }
  }

  return {
    restoreStatus(savedStatus) {
      settingsReady = true;
      status ??= savedStatus;
      if (status?.state !== "running") {
        completedStatusId = status?.id;
      }
      render();
    },
    updateAvailability,
    updateNotebookLink
  };
}

function sendNewNotebookAdd(payload: { source: CurrentPage; notebookUrl?: string }): Promise<NewNotebookAddStatus> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: "createNotebookAndAddSource", payload }, (response: unknown) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message || t("unexpectedError")));
        return;
      }
      if (typeof response !== "object" || response === null || !("ok" in response)) {
        reject(new Error(t("notebookAddResultUnreadable")));
        return;
      }
      if (response.ok === false && "error" in response && typeof response.error === "string") {
        reject(new Error(response.error));
        return;
      }
      if (response.ok !== true || !("result" in response) || typeof response.result !== "object" ||
          response.result === null || !("status" in response.result) || !isNewNotebookAddStatus(response.result.status)) {
        reject(new Error(t("notebookAddResultUnreadable")));
        return;
      }
      resolve(response.result.status);
    });
  });
}

function getElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing element: ${id}`);
  }
  return element as T;
}
