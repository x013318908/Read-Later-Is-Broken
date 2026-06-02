import type {
  AddJobStatusItem,
  CurrentPage,
  DateNotebookPeriod,
  LastAddStatus,
  NotebookAddJobRequest,
  NotebookAddJobResult,
  NotebookDirectAddFailure,
  NotebookDirectAddBatchRequest,
  NotebookDirectAddBatchResult,
  NotebookCreateRequest,
  NotebookCreateResult,
  NotebookDateAddRequest,
  NotebookDateAddResult,
  NotebookDirectAddRequest,
  NotebookDirectAddResponseKind,
  NotebookDirectAddResult,
  NotebookDirectAddTarget,
  NotebookListItem,
  NotebookListRequest,
  NotebookListResult
} from "./shared/types";
import { rememberLastAddStatus, upsertDestination } from "./shared/storage";

const MAX_PARALLEL_NOTEBOOK_ADDS = 3;

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (isNotebookAddJobMessage(message)) {
    void handleNotebookAddJob(message.payload)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error: unknown) => sendResponse({ ok: false, error: getErrorMessage(error) }));

    return true;
  }

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

  if (isNotebookListMessage(message)) {
    void handleNotebookList(message.payload)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error: unknown) => sendResponse({ ok: false, error: getErrorMessage(error) }));

    return true;
  }

  if (isNotebookCreateMessage(message)) {
    void handleNotebookCreate(message.payload)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error: unknown) => sendResponse({ ok: false, error: getErrorMessage(error) }));

    return true;
  }

  if (isNotebookDateAddMessage(message)) {
    void handleNotebookDateAdd(message.payload)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error: unknown) => sendResponse({ ok: false, error: getErrorMessage(error) }));

    return true;
  }

  return false;
});

async function handleNotebookAddJob(request: NotebookAddJobRequest): Promise<NotebookAddJobResult> {
  const startedAt = new Date().toISOString();
  const status: LastAddStatus = {
    id: crypto.randomUUID(),
    state: "running",
    source: request.source,
    startedAt,
    checkedAt: startedAt,
    message: "NotebookLMへの追加を実行中です。",
    items: []
  };

  await rememberLastAddStatus(status);

  const persistStatus = async (): Promise<void> => {
    status.checkedAt = new Date().toISOString();
    await rememberLastAddStatus({ ...status, items: [...status.items] });
  };

  if (request.existingTargets.length > 0) {
    try {
      const batchResult = await handleNotebookDirectAddBatch({
        source: request.source,
        targets: request.existingTargets
      });
      status.items.push({
        kind: "existing",
        name: `登録済み${request.existingTargets.length}件`,
        ok: true,
        message: batchResult.message
      });
    } catch (error) {
      status.items.push({
        kind: "existing",
        name: `登録済み${request.existingTargets.length}件`,
        ok: false,
        message: getErrorMessage(error)
      });
    }

    await persistStatus();
  }

  for (const period of request.datePeriods) {
    try {
      const result = await handleNotebookDateAdd({
        period,
        source: request.source
      });
      status.items.push({
        kind: period,
        name: result.title,
        ok: true,
        message: result.message,
        notebookUrl: result.notebookUrl
      });
      await upsertDestination({
        name: result.title,
        notebookUrl: result.notebookUrl
      });
    } catch (error) {
      status.items.push({
        kind: period,
        name: getDateNotebookTitle(period),
        ok: false,
        message: getErrorMessage(error)
      });
    }

    await persistStatus();
  }

  if (request.newNotebookTitle !== undefined) {
    try {
      const result = await handleNotebookCreate({
        title: request.newNotebookTitle,
        source: request.source
      });
      status.items.push({
        kind: "new",
        name: getNewNotebookDisplayName(result.title),
        ok: true,
        message: result.message,
        notebookUrl: result.notebookUrl
      });
      await upsertDestination({
        name: getNewNotebookDisplayName(result.title),
        notebookUrl: result.notebookUrl
      });
    } catch (error) {
      status.items.push({
        kind: "new",
        name: getNewNotebookDisplayName(request.newNotebookTitle),
        ok: false,
        message: getErrorMessage(error)
      });
    }

    await persistStatus();
  }

  status.state = getFinalAddJobState(status.items);
  status.message = buildAddJobStatusMessage(status.items);
  await persistStatus();

  return { status };
}

async function handleNotebookDirectAdd(request: NotebookDirectAddRequest): Promise<NotebookDirectAddResult> {
  return addSourceToNotebookTarget(request, { active: true, closeWhenDone: false });
}

function getFinalAddJobState(items: AddJobStatusItem[]): LastAddStatus["state"] {
  if (items.length === 0 || items.every((item) => !item.ok)) {
    return "failure";
  }

  return items.every((item) => item.ok) ? "success" : "partial";
}

function buildAddJobStatusMessage(items: AddJobStatusItem[]): string {
  const successItems = items.filter((item) => item.ok);
  const failureItems = items.filter((item) => !item.ok);

  if (items.length === 0) {
    return "追加先がありませんでした。";
  }

  if (failureItems.length === 0) {
    return `NotebookLMへの追加を実行しました（${successItems.map((item) => item.name).join(" + ")}）。`;
  }

  const failures = failureItems.map((item) => `${item.name}: ${item.message}`).join(" / ");

  if (successItems.length === 0) {
    return `NotebookLMへの追加に失敗しました（${failures}）。`;
  }

  return `NotebookLMへの追加を一部実行しました（${successItems
    .map((item) => item.name)
    .join(" + ")}）。失敗: ${failures}`;
}

async function handleNotebookDirectAddBatch(request: NotebookDirectAddBatchRequest): Promise<NotebookDirectAddBatchResult> {
  const attemptedCount = request.targets.length;

  for (let index = 0; index < request.targets.length; index += MAX_PARALLEL_NOTEBOOK_ADDS) {
    const targets = request.targets.slice(index, index + MAX_PARALLEL_NOTEBOOK_ADDS);
    await Promise.all(targets.map((target) => addSourceToNotebookTargetSilently(target, request.source)));
  }

  const checkedAt = new Date().toISOString();
  return {
    ok: true,
    source: request.source,
    attemptedCount,
    message: `NotebookLMへの追加を実行しました（${attemptedCount}件）。NotebookLM側でソース一覧を確認してください。`,
    checkedAt
  };
}

async function handleNotebookList(request: NotebookListRequest): Promise<NotebookListResult> {
  const authParams = await loadNotebookLmAuthParams(request.authuser);
  const [response] = await executeNotebookLmRpcs(authParams, [{ id: "wXbhsf", args: [null, 1] }]);
  const notebooks = parseNotebookListResponse(response, request.authuser);
  const checkedAt = new Date().toISOString();

  return {
    ok: true,
    notebooks,
    message: `NotebookLMから${notebooks.length}件のノートブックを読み込みました。`,
    checkedAt
  };
}

async function handleNotebookCreate(request: NotebookCreateRequest): Promise<NotebookCreateResult> {
  const title = request.title;
  const authParams = await loadNotebookLmAuthParams(request.authuser);
  const [createResponse] = await executeNotebookLmRpcs(authParams, [
    { id: "CCqFvf", args: buildNotebookCreateArgs(title, request.emoji) }
  ]);
  const notebookId = parseNotebookCreateResponse(createResponse);
  const notebookUrl = buildNotebookUrl(notebookId, request.authuser);

  await addNotebookLmSources(authParams, notebookId, [request.source.url]);

  const checkedAt = new Date().toISOString();
  return {
    ok: true,
    notebookId,
    notebookUrl,
    title,
    source: request.source,
    message: "新しいNotebookLMノートブックを作成し、URL追加を実行しました。",
    checkedAt
  };
}

async function handleNotebookDateAdd(request: NotebookDateAddRequest): Promise<NotebookDateAddResult> {
  const title = getDateNotebookTitle(request.period);
  const authParams = await loadNotebookLmAuthParams(request.authuser);
  const [listResponse] = await executeNotebookLmRpcs(authParams, [{ id: "wXbhsf", args: [null, 1] }]);
  const existingNotebook = selectDateNotebook(parseNotebookListResponse(listResponse, request.authuser), title);
  let notebookId = existingNotebook?.notebookId;
  let created = false;

  if (!notebookId) {
    const [createResponse] = await executeNotebookLmRpcs(authParams, [
      { id: "CCqFvf", args: buildNotebookCreateArgs(title, getDateNotebookEmoji(request.period)) }
    ]);
    notebookId = parseNotebookCreateResponse(createResponse);
    created = true;
  }

  const notebookUrl = buildNotebookUrl(notebookId, request.authuser);
  await addNotebookLmSources(authParams, notebookId, [request.source.url]);

  const checkedAt = new Date().toISOString();
  return {
    ok: true,
    period: request.period,
    notebookId,
    notebookUrl,
    title,
    source: request.source,
    created,
    message: `${getDateNotebookLabel(request.period)}ノートブック「${title}」を${
      created ? "作成" : "再利用"
    }し、URL追加を実行しました。`,
    checkedAt
  };
}

interface NotebookLmAuthParams {
  authuser?: string;
  at: string;
  bl: string;
}

interface NotebookLmRpcRequest {
  id: string;
  args: unknown[];
}

interface NotebookLmRpcResponse {
  index: number;
  rpcId: string;
  data: unknown;
}

async function loadNotebookLmAuthParams(authuser?: string): Promise<NotebookLmAuthParams> {
  const url = new URL("https://notebooklm.google.com/");

  if (authuser) {
    url.searchParams.set("authuser", authuser);
  }

  const response = await fetch(url.toString(), {
    credentials: "include"
  });
  const html = await response.text();
  const at = extractNotebookLmToken(html, "SNlM0e");
  const bl = extractNotebookLmToken(html, "cfb2h");

  if (!response.ok || !at || !bl) {
    throw new Error("NotebookLMにログインしているか確認してください。");
  }

  return { authuser, at, bl };
}

async function executeNotebookLmRpcs(
  authParams: NotebookLmAuthParams,
  rpcs: NotebookLmRpcRequest[]
): Promise<NotebookLmRpcResponse[]> {
  const url = new URL("https://notebooklm.google.com/_/LabsTailwindUi/data/batchexecute");
  url.searchParams.set("rpcids", rpcs.map((rpc) => rpc.id).join(","));
  url.searchParams.set("_reqid", Math.floor(Math.random() * 900000 + 100000).toString());
  url.searchParams.set("bl", authParams.bl);

  if (authParams.authuser) {
    url.searchParams.set("authuser", authParams.authuser);
  }

  const body = new URLSearchParams({
    "f.req": JSON.stringify([buildNotebookLmRpcRows(rpcs)]),
    at: authParams.at
  });
  const response = await fetch(url.toString(), {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded;charset=utf-8"
    },
    body,
    credentials: "include"
  });
  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(`NotebookLM RPCが失敗しました: HTTP ${response.status}`);
  }

  return parseNotebookLmRpcResponses(responseText);
}

function buildNotebookLmRpcRows(rpcs: NotebookLmRpcRequest[]): unknown[][] {
  if (rpcs.length === 1) {
    return [[rpcs[0].id, JSON.stringify(rpcs[0].args), null, "generic"]];
  }

  return rpcs.map((rpc, index) => [rpc.id, JSON.stringify(rpc.args), null, (index + 1).toString()]);
}

function parseNotebookLmRpcResponses(responseText: string): NotebookLmRpcResponse[] {
  const payload = extractNotebookLmRpcPayload(responseText);

  if (!payload) {
    throw new Error("NotebookLM RPCの応答が空でした。");
  }

  const rows = JSON.parse(payload) as unknown;

  if (!Array.isArray(rows)) {
    throw new Error("NotebookLM RPCの応答形式が想定と違います。");
  }

  return rows.flatMap((row) => parseNotebookLmRpcResponseRow(row));
}

function parseNotebookLmRpcResponseRow(row: unknown): NotebookLmRpcResponse[] {
  if (!Array.isArray(row) || row[0] !== "wrb.fr" || typeof row[1] !== "string" || typeof row[2] !== "string") {
    return [];
  }

  const rawIndex = row[6];
  const index = rawIndex === "generic" ? 1 : Number.parseInt(String(rawIndex), 10);

  return [
    {
      index: Number.isFinite(index) ? index : 1,
      rpcId: row[1],
      data: JSON.parse(row[2]) as unknown
    }
  ];
}

function parseNotebookListResponse(response: NotebookLmRpcResponse | undefined, authuser?: string): NotebookListItem[] {
  if (!response || response.rpcId !== "wXbhsf" || !Array.isArray(response.data)) {
    throw new Error("NotebookLMのノートブック一覧を読み込めませんでした。");
  }

  const rows = response.data[0];

  if (!Array.isArray(rows)) {
    return [];
  }

  return rows.flatMap((row) => parseNotebookListItem(row, authuser));
}

function parseNotebookListItem(row: unknown, authuser?: string): NotebookListItem[] {
  if (!Array.isArray(row) || typeof row[2] !== "string") {
    return [];
  }

  const title = typeof row[0] === "string" && row[0].trim() ? row[0].trim() : "Untitled";
  const emoji = typeof row[3] === "string" && row[3].trim() ? row[3].trim() : undefined;
  const updatedAtMs = parseNotebookUpdatedAtMs(row);

  return [
    {
      notebookId: row[2],
      title,
      emoji,
      notebookUrl: buildNotebookUrl(row[2], authuser),
      ...(updatedAtMs === undefined ? {} : { updatedAtMs })
    }
  ];
}

function parseNotebookUpdatedAtMs(row: unknown[]): number | undefined {
  const timestampTuple = row[5];

  if (!Array.isArray(timestampTuple)) {
    return undefined;
  }

  const rawTimestamp = timestampTuple[1] ?? timestampTuple[0];

  if (typeof rawTimestamp === "number" && Number.isFinite(rawTimestamp)) {
    return rawTimestamp;
  }

  if (typeof rawTimestamp === "string") {
    const parsed = Number.parseInt(rawTimestamp, 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

function selectDateNotebook(notebooks: NotebookListItem[], title: string): NotebookListItem | undefined {
  return notebooks
    .filter((notebook) => notebook.title === title)
    .sort((a, b) => (b.updatedAtMs ?? -1) - (a.updatedAtMs ?? -1))[0];
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

function getDateNotebookLabel(period: DateNotebookPeriod): string {
  switch (period) {
    case "daily":
      return "Daily";
    case "weekly":
      return "Weekly";
    case "monthly":
      return "Monthly";
  }
}

function getNewNotebookDisplayName(title: string): string {
  return title.trim() || "新しいノートブック";
}

function getDateNotebookEmoji(period: DateNotebookPeriod): string {
  switch (period) {
    case "daily":
      return "📅";
    case "weekly":
      return "📆";
    case "monthly":
      return "🗓️";
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

function parseNotebookCreateResponse(response: NotebookLmRpcResponse | undefined): string {
  if (!response || response.rpcId !== "CCqFvf" || !Array.isArray(response.data) || typeof response.data[2] !== "string") {
    throw new Error("NotebookLMの新規ノートブックを作成できませんでした。ノートブック数の上限に達している可能性があります。");
  }

  return response.data[2];
}

async function addNotebookLmSources(
  authParams: NotebookLmAuthParams,
  notebookId: string,
  sourceUrls: string[]
): Promise<void> {
  const sourcePayloads = sourceUrls.map((sourceUrl) =>
    sourceUrl.includes("youtube.com") ? [null, null, null, null, null, null, null, [sourceUrl]] : [null, null, [sourceUrl]]
  );
  const [response] = await executeNotebookLmRpcs(authParams, [
    { id: "izAoDd", args: [sourcePayloads, notebookId, [2]] }
  ]);

  if (!response || response.rpcId !== "izAoDd" || !response.data) {
    throw new Error("NotebookLMノートブックへURLを追加できませんでした。ノートブック内のソース数上限、保護されたページ、または非対応URLの可能性があります。");
  }
}

function buildNotebookCreateArgs(title: string, emoji?: string): unknown[] {
  return emoji === undefined ? [title] : [title, emoji];
}

function buildNotebookUrl(notebookId: string, authuser?: string): string {
  const url = new URL(`https://notebooklm.google.com/notebook/${notebookId}`);

  if (authuser) {
    url.searchParams.set("authuser", authuser);
  }

  return url.toString();
}

function extractNotebookLmToken(html: string, name: string): string | undefined {
  return new RegExp(`"${name}":"([^"]+)"`).exec(html)?.[1];
}

function extractNotebookLmRpcPayload(responseText: string): string {
  const text = responseText.trim();

  if (!text) {
    return "";
  }

  if (!text.startsWith(")]}'")) {
    return text;
  }

  return text.split("\n").slice(1).join("\n").trim();
}

async function addSourceToNotebookTargetSilently(target: NotebookDirectAddTarget, source: CurrentPage): Promise<void> {
  try {
    await addSourceToNotebookTarget(
      {
        notebookUrl: target.notebookUrl,
        source
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
    : "URL追加OK: NotebookLMにソース追加RPCを送信しました。";

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

function isNotebookAddJobMessage(value: unknown): value is {
  type: "runNotebookAddJob";
  payload: NotebookAddJobRequest;
} {
  return (
    isRecord(value) &&
    value.type === "runNotebookAddJob" &&
    isRecord(value.payload) &&
    isCurrentPage(value.payload.source) &&
    Array.isArray(value.payload.existingTargets) &&
    value.payload.existingTargets.every(isNotebookDirectAddTarget) &&
    Array.isArray(value.payload.datePeriods) &&
    value.payload.datePeriods.every(isDateNotebookPeriod) &&
    (value.payload.newNotebookTitle === undefined || typeof value.payload.newNotebookTitle === "string")
  );
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

function isNotebookListMessage(value: unknown): value is {
  type: "listNotebookLmNotebooks";
  payload: NotebookListRequest;
} {
  return (
    isRecord(value) &&
    value.type === "listNotebookLmNotebooks" &&
    isRecord(value.payload) &&
    (value.payload.authuser === undefined || typeof value.payload.authuser === "string")
  );
}

function isNotebookCreateMessage(value: unknown): value is {
  type: "createNotebookLmNotebook";
  payload: NotebookCreateRequest;
} {
  return (
    isRecord(value) &&
    value.type === "createNotebookLmNotebook" &&
    isRecord(value.payload) &&
    typeof value.payload.title === "string" &&
    isCurrentPage(value.payload.source) &&
    (value.payload.emoji === undefined || typeof value.payload.emoji === "string") &&
    (value.payload.authuser === undefined || typeof value.payload.authuser === "string")
  );
}

function isNotebookDateAddMessage(value: unknown): value is {
  type: "addSourceToDateNotebook";
  payload: NotebookDateAddRequest;
} {
  return (
    isRecord(value) &&
    value.type === "addSourceToDateNotebook" &&
    isRecord(value.payload) &&
    isDateNotebookPeriod(value.payload.period) &&
    isCurrentPage(value.payload.source) &&
    (value.payload.authuser === undefined || typeof value.payload.authuser === "string")
  );
}

function isDateNotebookPeriod(value: unknown): value is DateNotebookPeriod {
  return value === "daily" || value === "weekly" || value === "monthly";
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
