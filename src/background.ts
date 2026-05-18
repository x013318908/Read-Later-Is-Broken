import type {
  CurrentPage,
  NotebookDirectAddFailure,
  NotebookDirectAddBatchRequest,
  NotebookDirectAddBatchResult,
  NotebookDirectAddRequest,
  NotebookDirectAddResponseKind,
  NotebookDirectAddResult,
  NotebookDirectAddTarget
} from "./shared/types";

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    chrome.runtime.openOptionsPage();
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (isNotebookDirectAddMessage(message)) {
    void handleNotebookDirectAdd(message.payload)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error: unknown) => sendResponse({ ok: false, error: getErrorMessage(error) }));

    return true;
  }

  if (isNotebookDirectAddBatchMessage(message)) {
    void handleNotebookDirectAddBatch(message.payload)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error: unknown) => sendResponse({ ok: false, error: getErrorMessage(error) }));

    return true;
  }

  return false;
});

async function handleNotebookDirectAdd(request: NotebookDirectAddRequest): Promise<NotebookDirectAddResult> {
  return addSourceToNotebookTarget(request, { active: true, closeWhenDone: false });
}

async function handleNotebookDirectAddBatch(request: NotebookDirectAddBatchRequest): Promise<NotebookDirectAddBatchResult> {
  let attemptedCount = 0;

  for (const target of request.targets) {
    attemptedCount += 1;

    try {
      await addSourceToNotebookTarget(
        {
          notebookUrl: target.notebookUrl,
          source: request.source
        },
        { active: false, closeWhenDone: true }
      );
    } catch (error) {
      console.warn(
        `Read Later Is Broken: NotebookLM add request did not return a stable result for ${target.name}.`,
        getErrorMessage(error)
      );
    }
  }

  const checkedAt = new Date().toISOString();
  return {
    ok: true,
    source: request.source,
    attemptedCount,
    message: `NotebookLMへの追加を実行しました（${attemptedCount}件）。NotebookLM側でソース一覧を確認してください。Deep Diveは生成していません。`,
    checkedAt
  };
}

async function addSourceToNotebookTarget(
  request: NotebookDirectAddRequest,
  options: { active: boolean; closeWhenDone: boolean }
): Promise<NotebookDirectAddResult> {
  const notebookTarget = getNotebookTarget(request.notebookUrl);

  if (!notebookTarget) {
    throw new Error("NotebookLM のノートブックURLを選択してください。");
  }

  const tab = await chrome.tabs.create({ url: request.notebookUrl, active: options.active });

  if (!tab.id) {
    throw new Error("NotebookLM タブを開けませんでした。");
  }

  try {
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

    return result;
  } finally {
    if (options.closeWhenDone) {
      await chrome.tabs.remove(tab.id).catch(() => undefined);
    }
  }
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
    const failure: NotebookDirectAddFailure = {
      code: "token-missing",
      title: "NotebookLMのログイン状態を確認できませんでした。",
      action: "NotebookLMでログイン済みか、ページの読み込みが完了しているか確認してください。",
      diagnostic: `missing tokens: at=${Boolean(at)}, bl=${Boolean(bl)}`
    };
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
        ok: false,
        responseKind: "not-attempted"
      },
      failure,
      message: `URL追加NG: ${failure.title} ${failure.action}`,
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
  let responseKind: NotebookDirectAddResponseKind = "empty-response";
  let requestError: string | undefined;

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
    responseKind = analyzeAddSourceResponse(responseText);
    responseReceived = responseKind === "success";
    rpcOk = response.ok && responseReceived;
  } catch (error) {
    responseKind = "request-error";
    requestError = error instanceof Error ? error.message : "request failed";
    rpcOk = false;
  }

  const failure = rpcOk
    ? undefined
    : getDirectAddFailure({
        status: responseStatus,
        responseKind,
        requestError
      });
  const message = failure
    ? `URL追加NG: ${failure.title} ${failure.action}`
    : "URL追加OK: NotebookLMにソース追加RPCを送信しました。Deep Diveは生成していません。";

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
      responseReceived,
      responseKind,
      error: requestError
    },
    failure,
    message,
    checkedAt
  };

  renderDirectAddStatus(result);
  return result;

  function analyzeAddSourceResponse(responseText: string): NotebookDirectAddResponseKind {
    try {
      const payload = extractRpcPayload(responseText);

      if (!payload) {
        return "empty-response";
      }

      const rows = JSON.parse(payload) as unknown;

      if (!Array.isArray(rows)) {
        return "parse-error";
      }

      const sourceAddRow = rows.find((row) => {
        return Array.isArray(row) && row[0] === "wrb.fr" && row[1] === "izAoDd";
      });

      if (!Array.isArray(sourceAddRow) || typeof sourceAddRow[2] !== "string") {
        return "rpc-row-missing";
      }

      try {
        const data = JSON.parse(sourceAddRow[2]) as unknown;
        return data ? "success" : "rpc-data-empty";
      } catch {
        return "rpc-data-invalid";
      }
    } catch {
      return "parse-error";
    }
  }

  function extractRpcPayload(responseText: string): string {
    const text = responseText.trim();

    if (!text) {
      return "";
    }

    if (!text.startsWith(")]}'")) {
      return text;
    }

    return text.split("\n").slice(1).join("\n").trim();
  }

  function getDirectAddFailure(input: {
    status?: number;
    responseKind: NotebookDirectAddResponseKind;
    requestError?: string;
  }): NotebookDirectAddFailure {
    if (input.responseKind === "request-error") {
      return {
        code: "request-error",
        title: "NotebookLMへの通信に失敗しました。",
        action: "ネットワーク状態を確認して、もう一度試してください。",
        diagnostic: input.requestError ?? "fetch failed"
      };
    }

    if (input.status === 401 || input.status === 403) {
      return {
        code: "login-or-permission",
        title: "NotebookLMにログインしていないか、このノートブックにアクセスできません。",
        action: "NotebookLMタブでログイン状態と、登録したノートブックURLのGoogleアカウントを確認してください。",
        diagnostic: `http ${input.status}`
      };
    }

    if (input.status === 429) {
      return {
        code: "rate-limited",
        title: "NotebookLM側で連続追加が制限された可能性があります。",
        action: "少し時間を置いてから、もう一度試してください。",
        diagnostic: "http 429"
      };
    }

    if (typeof input.status === "number" && input.status >= 500) {
      return {
        code: "server-error",
        title: "NotebookLM側で一時的なエラーが起きた可能性があります。",
        action: "NotebookLMタブを再読み込みするか、時間を置いて再試行してください。",
        diagnostic: `http ${input.status}`
      };
    }

    if (input.responseKind === "rpc-data-empty") {
      return {
        code: "source-rejected",
        title: "NotebookLMは応答しましたが、ソース追加結果が空でした。",
        action: "ノートブックのソース上限、保護されたページ、または非対応URLの可能性があります。",
        diagnostic: `${input.responseKind}, http ${input.status ?? "n/a"}`
      };
    }

    if (
      input.responseKind === "parse-error" ||
      input.responseKind === "rpc-row-missing" ||
      input.responseKind === "rpc-data-invalid"
    ) {
      return {
        code: "notebooklm-response-changed",
        title: "NotebookLMの内部応答形式が想定と違います。",
        action: "NotebookLM側の仕様変更の可能性があります。拡張機能側の更新が必要です。",
        diagnostic: `${input.responseKind}, http ${input.status ?? "n/a"}`
      };
    }

    return {
      code: "unknown",
      title: "NotebookLMへのソース追加RPCが成功しませんでした。",
      action: "NotebookLMタブでソース一覧を確認してから、必要なら再試行してください。",
      diagnostic: `${input.responseKind}, http ${input.status ?? "n/a"}`
    };
  }

  function appendFailureAction(status: HTMLDivElement, result: NotebookDirectAddResult): void {
    if (!result.failure?.action) {
      return;
    }

    const action = document.createElement("div");
    action.textContent = result.failure.action;
    action.style.marginTop = "4px";
    status.append(action);
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
    body.textContent = result.ok ? result.message : result.failure?.title ?? result.message;

    const meta = document.createElement("div");
    meta.textContent = `reason=${result.failure?.code ?? "none"} / status=${
      result.rpc.status ?? "n/a"
    } / response=${result.rpc.responseReceived ? "received" : result.rpc.responseKind ?? "missing"}`;
    meta.style.marginTop = "6px";
    meta.style.color = "#665f55";
    meta.style.fontSize = "12px";

    status.append(title, body);
    appendFailureAction(status, result);
    status.append(meta);
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

function isNotebookDirectAddBatchMessage(value: unknown): value is {
  type: "addSourcesToNotebooks";
  payload: NotebookDirectAddBatchRequest;
} {
  return (
    isRecord(value) &&
    value.type === "addSourcesToNotebooks" &&
    isRecord(value.payload) &&
    isCurrentPage(value.payload.source) &&
    Array.isArray(value.payload.targets) &&
    value.payload.targets.length > 0 &&
    value.payload.targets.every(isNotebookDirectAddTarget)
  );
}

function isNotebookDirectAddTarget(value: unknown): value is NotebookDirectAddTarget {
  return (
    isRecord(value) &&
    typeof value.destinationId === "string" &&
    typeof value.name === "string" &&
    typeof value.notebookUrl === "string"
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
