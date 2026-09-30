export interface ButtonFeedbackResult {
  variant: "success" | "warning" | "danger";
  label: string;
}

interface ButtonFeedback {
  idleLabel: string;
  pendingLabel: (count: number) => string;
  pendingCount: number;
  result?: ButtonFeedbackResult;
  resetTimeout?: number;
}

const feedbackByButton = new WeakMap<HTMLButtonElement, ButtonFeedback>();
const resultPriority = { success: 0, warning: 1, danger: 2 };

export function setButtonLabel(button: HTMLButtonElement, label: string): void {
  const feedback = getButtonFeedback(button);
  feedback.idleLabel = label;
  renderButtonFeedback(button, feedback);
}

export function startButtonFeedback(
  button: HTMLButtonElement,
  pendingLabel: string | ((count: number) => string)
): (result: ButtonFeedbackResult) => void {
  const feedback = getButtonFeedback(button);
  window.clearTimeout(feedback.resetTimeout);
  if (feedback.pendingCount === 0) {
    feedback.result = undefined;
  }
  feedback.pendingLabel = typeof pendingLabel === "string" ? () => pendingLabel : pendingLabel;
  feedback.pendingCount += 1;
  renderButtonFeedback(button, feedback);

  let finished = false;
  return (result) => {
    if (finished) {
      return;
    }
    finished = true;
    feedback.pendingCount -= 1;

    // Keep an earlier failure visible when later jobs in the same queue succeed.
    if (!feedback.result || resultPriority[result.variant] > resultPriority[feedback.result.variant]) {
      feedback.result = result;
    }

    renderButtonFeedback(button, feedback);
    if (feedback.pendingCount === 0) {
      scheduleFeedbackReset(button, feedback);
    }
  };
}

export function showButtonFeedback(button: HTMLButtonElement, result: ButtonFeedbackResult): void {
  const feedback = getButtonFeedback(button);
  if (feedback.pendingCount > 0) {
    return;
  }

  feedback.result = result;
  renderButtonFeedback(button, feedback);
  scheduleFeedbackReset(button, feedback);
}

export function resetButtonFeedback(button: HTMLButtonElement): void {
  const feedback = getButtonFeedback(button);
  if (feedback.pendingCount > 0) {
    return;
  }

  window.clearTimeout(feedback.resetTimeout);
  feedback.result = undefined;
  renderButtonFeedback(button, feedback);
}

function getButtonFeedback(button: HTMLButtonElement): ButtonFeedback {
  let feedback = feedbackByButton.get(button);
  if (!feedback) {
    feedback = {
      idleLabel: button.textContent ?? "",
      pendingLabel: () => "",
      pendingCount: 0
    };
    feedbackByButton.set(button, feedback);
  }
  return feedback;
}

function renderButtonFeedback(button: HTMLButtonElement, feedback: ButtonFeedback): void {
  const busy = feedback.pendingCount > 0;
  button.setAttribute("aria-busy", String(busy));
  button.textContent = busy
    ? feedback.pendingLabel(feedback.pendingCount)
    : feedback.result?.label ?? feedback.idleLabel;

  if (busy) {
    button.dataset.feedback = "busy";
  } else if (feedback.result) {
    button.dataset.feedback = feedback.result.variant;
  } else {
    delete button.dataset.feedback;
  }
}

function scheduleFeedbackReset(button: HTMLButtonElement, feedback: ButtonFeedback): void {
  window.clearTimeout(feedback.resetTimeout);
  feedback.resetTimeout = window.setTimeout(() => {
    feedback.result = undefined;
    renderButtonFeedback(button, feedback);
  }, feedback.result?.variant === "success" ? 3000 : 6000);
}
