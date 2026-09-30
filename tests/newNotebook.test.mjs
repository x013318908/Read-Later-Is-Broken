import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const messages = JSON.parse(await readFile(new URL("../public/_locales/en/messages.json", import.meta.url), "utf8"));
const source = { title: "Original article", url: "https://example.com/article" };
const initialSettings = {
  destinations: [{ id: "existing", name: "Existing theme", notebookUrl: "https://notebook.google.com/notebook/existing",
    sourceCount: 8, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" }],
  selectedDestinationIds: ["existing"], dailyDestinationEnabled: true,
  weeklyDestinationEnabled: true, monthlyDestinationEnabled: false
};
let importId = 0;

async function harness(options = {}) {
  const storage = { settings: structuredClone(initialSettings) };
  const phases = [];
  const calls = [];
  let listener;
  const area = {
    get(_key, callback) { queueMicrotask(() => callback(structuredClone(storage))); },
    set(value, callback) {
      if (value.newNotebookAddStatus) options.beforeStatusWrite?.(storage, value.newNotebookAddStatus);
      Object.assign(storage, structuredClone(value));
      const status = value.newNotebookAddStatus;
      if (status) phases.push(structuredClone(status));
      queueMicrotask(callback);
    }
  };
  const originalChrome = globalThis.chrome;
  const originalFetch = globalThis.fetch;
  globalThis.chrome = {
    runtime: { onMessage: { addListener(callback) { listener = callback; } } },
    storage: { local: area, sync: area },
    i18n: { getMessage(key, substitutions = []) {
      const entry = messages[key];
      if (!entry) return key;
      const values = typeof substitutions === "string" ? [substitutions] : substitutions;
      let message = entry.message;
      for (const [name, placeholder] of Object.entries(entry.placeholders || {})) {
        message = message.replaceAll(`$${name.toUpperCase()}$`, values[Number(placeholder.content.slice(1)) - 1] || "");
      }
      return message;
    } }
  };
  globalThis.fetch = async (url, init) => {
    if (!init?.method) {
      return new Response(options.authFailure ? "Login required" : '"SNlM0e":"fake-at","cfb2h":"fake-bl"');
    }
    const rows = JSON.parse(new URLSearchParams(init.body).get("f.req"))[0];
    const responses = rows.map(([id, args]) => {
      const parsedArgs = JSON.parse(args);
      calls.push({ id, args: parsedArgs, authuser: new URL(url).searchParams.get("authuser") });
      let data;
      if (id === "CCqFvf") {
        data = options.createFailure ? [] : [null, null, "created-1"];
      } else if (id === "izAoDd") {
        data = options.addFailure ? null : ["source-added"];
      } else {
        throw new Error(`Unexpected RPC: ${id}`);
      }
      return ["wrb.fr", id, JSON.stringify(data), null, null, null, "generic"];
    });
    return new Response(JSON.stringify(responses));
  };
  await import(new URL(`../dist/background.js?test=${++importId}`, import.meta.url));
  return {
    storage, phases, calls, options,
    send(payload, type = "createNotebookAndAddSource") {
      return new Promise((resolve, reject) => {
        if (!listener({ type, payload }, {}, resolve)) reject(new Error("Message rejected"));
      });
    },
    sendWithoutPopup(payload) { assert.equal(listener({ type: "createNotebookAndAddSource", payload }, {}, () => {}), true); },
    close() { globalThis.chrome = originalChrome; globalThis.fetch = originalFetch; }
  };
}

test("creates with an empty title and adds only to the new notebook", async () => {
  const env = await harness();
  try {
    const response = await env.send({ source });
    assert.equal(response.ok, true);
    assert.equal(response.result.status.state, "success");
    assert.equal(response.result.status.notebookUrl, "https://notebook.google.com/notebook/created-1");
    assert.deepEqual(env.calls.map((call) => call.id), ["CCqFvf", "izAoDd"]);
    assert.deepEqual(env.calls[0].args, [""]);
    assert.equal(env.calls[1].args[1], "created-1");
    assert.equal(env.calls[1].args[0][0][2][0], source.url);
    assert.deepEqual(env.storage.settings.selectedDestinationIds, initialSettings.selectedDestinationIds);
    assert.equal(env.storage.settings.dailyDestinationEnabled, true);
    assert.equal(env.storage.settings.weeklyDestinationEnabled, true);
    assert.equal(env.storage.settings.destinations[0].sourceCount, 8);
    assert.equal(env.storage.settings.destinations[1].sourceCount, 1);
    assert.ok(env.phases.some((status) => status.phase === "adding" && status.state === "running" && status.notebookUrl));
  } finally { env.close(); }
});

test("failed add preserves the created notebook and retry skips creation", async () => {
  const env = await harness({ addFailure: true });
  try {
    const failed = (await env.send({ source })).result.status;
    assert.equal(failed.state, "failure");
    assert.equal(failed.phase, "adding");
    assert.ok(failed.notebookUrl);
    assert.deepEqual(env.storage.newNotebookAddStatus.source, source);
    env.options.addFailure = false;
    const response = await env.send({ source: failed.source, notebookUrl: failed.notebookUrl });
    assert.equal(response.result.status.state, "success");
    assert.equal(response.result.status.notebookUrl, failed.notebookUrl);
    assert.deepEqual(env.calls.map((call) => call.id), ["CCqFvf", "izAoDd", "izAoDd"]);
    assert.equal(env.storage.settings.destinations.length, 2);
    assert.deepEqual(env.storage.settings.selectedDestinationIds, ["existing"]);
  } finally { env.close(); }
});

test("creation failure does not attempt an add or offer a created destination", async () => {
  const env = await harness({ createFailure: true });
  try {
    const status = (await env.send({ source })).result.status;
    assert.equal(status.state, "failure");
    assert.equal(status.phase, "creating");
    assert.equal(status.notebookUrl, undefined);
    assert.deepEqual(env.calls.map((call) => call.id), ["CCqFvf"]);
    assert.deepEqual(env.storage.settings.destinations, initialSettings.destinations);
  } finally { env.close(); }
});

test("login failure is saved without attempting creation", async () => {
  const env = await harness({ authFailure: true });
  try {
    const response = await env.send({ source });
    assert.equal(response.result.status.state, "failure");
    assert.equal(env.calls.length, 0);
    assert.equal(env.storage.newNotebookAddStatus.state, "failure");
  } finally { env.close(); }
});

test("retry validates the destination and preserves its account", async () => {
  const env = await harness();
  try {
    const invalid = await env.send({ source, notebookUrl: "https://example.com/notebook/invalid" });
    assert.equal(invalid.ok, false);
    assert.equal(env.calls.length, 0);
    const response = await env.send({ source, notebookUrl: "https://notebook.google.com/notebook/retry-target?authuser=2" });
    assert.equal(response.result.status.state, "success");
    assert.deepEqual(env.calls.map((call) => call.id), ["izAoDd"]);
    assert.equal(env.calls[0].args[1], "retry-target");
    assert.equal(env.calls[0].authuser, "2");
  } finally { env.close(); }
});

test("the job finishes and persists its result without an open popup", async () => {
  const env = await harness();
  try {
    env.sendWithoutPopup({ source });
    for (let attempt = 0; attempt < 100 && env.storage.newNotebookAddStatus?.state !== "success"; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal(env.storage.newNotebookAddStatus.state, "success");
    assert.equal(env.storage.settings.destinations.length, 2);
  } finally { env.close(); }
});

test("the existing named-create message still uses its supplied title", async () => {
  const env = await harness();
  try {
    const response = await env.send({ title: "Named topic" }, "createNotebookLmNotebook");
    assert.equal(response.ok, true);
    assert.deepEqual(env.calls.map((call) => call.id), ["CCqFvf"]);
    assert.deepEqual(env.calls[0].args, ["Named topic"]);
    assert.equal(env.storage.newNotebookAddStatus, undefined);
  } finally { env.close(); }
});

test("progress writes preserve concurrent destination settings and survive stale settings saves", async () => {
  const env = await harness({ beforeStatusWrite(storage, status) {
    if (status.phase === "adding" && status.state === "running") {
      storage.settings.selectedDestinationIds = [];
      storage.settings.dailyDestinationEnabled = false;
      storage.settings.monthlyDestinationEnabled = true;
    }
  } });
  try {
    await env.send({ source });
    assert.deepEqual(env.storage.settings.selectedDestinationIds, []);
    assert.equal(env.storage.settings.dailyDestinationEnabled, false);
    assert.equal(env.storage.settings.monthlyDestinationEnabled, true);
    env.storage.settings = structuredClone(initialSettings);
    assert.equal(env.storage.newNotebookAddStatus.state, "success");
    assert.deepEqual(env.storage.newNotebookAddStatus.source, source);
    assert.equal(env.storage.settings.lastNewNotebookAddStatus, undefined);
  } finally { env.close(); }
});
