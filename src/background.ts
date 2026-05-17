import type { CurrentPage, NotebookDirectAddRequest, NotebookDirectAddResult } from "./shared/types";

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    chrome.runtime.openOptionsPage();
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!isNotebookDirectAddMessage(message)) {
    return false;
  }

  void handleNotebookDirectAdd(message.payload)
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error: unknown) => sendResponse({ ok: false, error: getErrorMessage(error) }));

  return true;
});

async function handleNotebookDirectAdd(request: NotebookDirectAddRequest): Promise<NotebookDirectAddResult> {
  const notebookTarget = getNotebookTarget(request.notebookUrl);

  if (!notebookTarget) {
    throw new Error("NotebookLM のノートブックURLを選択してください。");
  }

  const tab = await chrome.tabs.create({ url: request.notebookUrl, active: true });

  if (!tab.id) {
    throw new Error("NotebookLM タブを開けませんでした。");
  }

  await waitForTabComplete(tab.id);

  const [injectionResult] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: "MAIN",
    func: addSourceToNotebookPage,
    args: [
      {
        notebookUrl: request.notebookUrl,
        notebookId: notebookTarget.notebookId,
        authuser: notebookTarget.authuser,
        source: request.source
      }
    ]
  });

  const result = injectionResult?.result;

  if (!isNotebookDirectAddResult(result)) {
    throw new Error("NotebookLM タブからURL追加結果を取得できませんでした。");
  }

  await chrome.storage.local.set({ lastNotebookDirectAddResult: result });
  return result;
}

async function addSourceToNotebookPage(input: {
  notebookUrl: string;
  notebookId: string;
  authuser?: string;
  source: CurrentPage;
}): Promise<NotebookDirectAddResult> {
  const html = document.documentElement.innerHTML;
  const at = /"SNlM0e":"([^"]+)"/.exec(html)?.[1];
  const bl = /"cfb2h":"([^"]+)"/.exec(html)?.[1];
  const checkedAt = new Date().toISOString();

  if (!at || !bl) {
    const result: NotebookDirectAddResult = {
      ok: false,
      notebookUrl: input.notebookUrl,
      notebookId: input.notebookId,
      source: input.source,
      tokens: {
        at: Boolean(at),
        bl: Boolean(bl)
      },
      rpc: {
        attempted: false,
        ok: false
      },
      message:
        "URL追加NG: NotebookLMページ内で必要トークンを検出できませんでした。ログイン状態またはページ読み込みを確認してください。",
      checkedAt
    };

    renderDirectAddStatus(result);
    return result;
  }

  const rpcUrl = new URL("/_/LabsTailwindUi/data/batchexecute", window.location.origin);
  rpcUrl.searchParams.set("rpcids", "izAoDd");
  rpcUrl.searchParams.set("_reqid", Math.floor(Math.random() * 900000 + 100000).toString());
  rpcUrl.searchParams.set("bl", bl);
  if (input.authuser) {
    rpcUrl.searchParams.set("authuser", input.authuser);
  }

  const sourcePayload = input.source.url.includes("youtube.com")
    ? [null, null, null, null, null, null, null, [input.source.url]]
    : [null, null, [input.source.url]];
  const rpcArgs = [[sourcePayload], input.notebookId, [2]];
  const fReq = JSON.stringify([[["izAoDd", JSON.stringify(rpcArgs), null, "generic"]]]);
  const requestBody = new URLSearchParams({
    "f.req": fReq,
    at
  });

  let responseStatus: number | undefined;
  let responseReceived = false;
  let rpcOk = false;

  try {
    const response = await fetch(rpcUrl.toString(), {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded;charset=utf-8"
      },
      body: requestBody,
      credentials: "include"
    });
    responseStatus = response.status;

    const responseText = await response.text();
    responseReceived = hasSuccessfulAddSourceResponse(responseText);
    rpcOk = response.ok && responseReceived;
  } catch {
    rpcOk = false;
  }

  const result: NotebookDirectAddResult = {
    ok: rpcOk,
    notebookUrl: input.notebookUrl,
    notebookId: input.notebookId,
    source: input.source,
    tokens: {
      at: true,
      bl: true
    },
    rpc: {
      attempted: true,
      ok: rpcOk,
      status: responseStatus,
      responseReceived
    },
    message: rpcOk
      ? "URL追加OK: NotebookLMにソース追加RPCを送信しました。Deep Diveは生成していません。"
      : "URL追加NG: NotebookLMへのソース追加RPCが成功しませんでした。",
    checkedAt
  };

  renderDirectAddStatus(result);
  return result;

  function hasSuccessfulAddSourceResponse(responseText: string): boolean {
    try {
      const payload = responseText.split("\n").slice(2).join("");

      if (!payload) {
        return false;
      }

      const rows = JSON.parse(payload) as unknown;

      if (!Array.isArray(rows)) {
        return false;
      }

      return rows.some((row) => {
        if (!Array.isArray(row) || row[0] !== "wrb.fr" || row[1] !== "izAoDd" || typeof row[2] !== "string") {
          return false;
        }

        try {
          return JSON.parse(row[2]) !== null;
        } catch {
          return false;
        }
      });
    } catch {
      return false;
    }
  }

  function renderDirectAddStatus(result: NotebookDirectAddResult): void {
    const id = "read-later-is-broken-direct-add";
    document.getElementById(id)?.remove();

    const status = document.createElement("div");
    status.id = id;
    status.setAttribute("role", "status");
    status.style.position = "fixed";
    status.style.top = "16px";
    status.style.right = "16px";
    status.style.zIndex = "2147483647";
    status.style.maxWidth = "360px";
    status.style.border = "1px solid rgba(39, 35, 30, 0.16)";
    status.style.borderRadius = "8px";
    status.style.padding = "12px 14px";
    status.style.background = result.ok ? "#f2fbf6" : "#fff4f1";
    status.style.color = "#22201c";
    status.style.boxShadow = "0 18px 48px rgba(40, 34, 25, 0.18)";
    status.style.font =
      "13px/1.45 Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";

    const title = document.createElement("strong");
    title.textContent = result.ok ? "Read Later Is Broken: URL追加OK" : "Read Later Is Broken: URL追加NG";
    title.style.display = "block";
    title.style.marginBottom = "6px";

    const body = document.createElement("div");
    body.textContent = result.message;

    const meta = document.createElement("div");
    meta.textContent = `status=${result.rpc.status ?? "n/a"} / response=${
      result.rpc.responseReceived ? "received" : "missing"
    }`;
    meta.style.marginTop = "6px";
    meta.style.color = "#665f55";
    meta.style.fontSize = "12px";

    status.append(title, body, meta);
    document.body.append(status);
  }
}

function waitForTabComplete(tabId: number): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      finish();
      reject(new Error("NotebookLM の読み込みがタイムアウトしました。"));
    }, 30000);

    const finish = (): void => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(listener);
    };

    const listener = (updatedTabId: number, changeInfo: chrome.tabs.TabChangeInfo): void => {
      if (updatedTabId === tabId && changeInfo.status === "complete") {
        finish();
        resolve();
      }
    };

    chrome.tabs.onUpdated.addListener(listener);
    void chrome.tabs.get(tabId).then((tab) => {
      if (!settled && tab.status === "complete") {
        finish();
        resolve();
      }
    });
  });
}

function getNotebookTarget(notebookUrl: string): { notebookId: string; authuser?: string } | undefined {
  try {
    const url = new URL(notebookUrl);

    if (url.protocol !== "https:" || url.hostname !== "notebooklm.google.com") {
      return undefined;
    }

    const notebookId = /^\/notebook\/([^/?#]+)/.exec(url.pathname)?.[1];

    if (!notebookId) {
      return undefined;
    }

    return {
      notebookId,
      authuser: url.searchParams.get("authuser") ?? undefined
    };
  } catch {
    return undefined;
  }
}

function isNotebookDirectAddMessage(value: unknown): value is {
  type: "addSourceToNotebook";
  payload: NotebookDirectAddRequest;
} {
  return (
    isRecord(value) &&
    value.type === "addSourceToNotebook" &&
    isRecord(value.payload) &&
    typeof value.payload.notebookUrl === "string" &&
    isCurrentPage(value.payload.source)
  );
}

function isNotebookDirectAddResult(value: unknown): value is NotebookDirectAddResult {
  return (
    isRecord(value) &&
    typeof value.ok === "boolean" &&
    typeof value.notebookUrl === "string" &&
    isCurrentPage(value.source) &&
    isRecord(value.tokens) &&
    typeof value.tokens.at === "boolean" &&
    typeof value.tokens.bl === "boolean" &&
    isRecord(value.rpc) &&
    typeof value.rpc.attempted === "boolean" &&
    typeof value.rpc.ok === "boolean" &&
    typeof value.message === "string" &&
    typeof value.checkedAt === "string"
  );
}

function isCurrentPage(value: unknown): value is CurrentPage {
  return isRecord(value) && typeof value.title === "string" && typeof value.url === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "予期しないエラーが発生しました。";
}
