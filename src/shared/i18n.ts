export type MessageSubstitution = string | string[];

export function t(messageName: string, substitutions?: MessageSubstitution): string {
  const message = chrome.i18n.getMessage(messageName, substitutions);
  return message || messageName;
}

export function getUiLanguage(): string {
  return chrome.i18n.getUILanguage?.() || "en";
}

export function applyDocumentI18n(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>("[data-i18n]").forEach((element) => {
    const messageName = element.dataset.i18n;

    if (messageName) {
      element.textContent = t(messageName);
    }
  });

  root.querySelectorAll<HTMLElement>("[data-i18n-placeholder]").forEach((element) => {
    const messageName = element.dataset.i18nPlaceholder;

    if (messageName && isPlaceholderElement(element)) {
      element.placeholder = t(messageName);
    }
  });

  root.querySelectorAll<HTMLElement>("[data-i18n-aria-label]").forEach((element) => {
    const messageName = element.dataset.i18nAriaLabel;

    if (messageName) {
      element.setAttribute("aria-label", t(messageName));
    }
  });
}

function isPlaceholderElement(element: HTMLElement): element is HTMLInputElement | HTMLTextAreaElement {
  return element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement;
}
