import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { test } from "node:test";
import { generateKey } from "near-kit";
import { market, MARKET_USDC, MARKET_PAYEE } from "./e2e/market.mjs";
import { keySigner } from "../src/market/payment-key.js";
import { paymentHeader } from "../src/market/x402.js";

const agents = {
  worker: { amount: "100000", windowSeconds: 600, outcome: "worker" },
  other: { amount: "100000", windowSeconds: 600, outcome: "worker" },
};
const get = (sim: any, path: string, worker = "worker") => fetch(sim.url + path, {
  headers: worker ? { authorization: `Bearer ${sim.credentials(worker).token}`, accept: "application/json" } : {},
});
const base = (id: string) => `/v1/assignments/${id}/deliverable`;

async function hire(sim: any) {
  const payer = keySigner(generateKey().secretKey);
  sim.fund(payer.account, "100000");
  const row = { amount: "100000", asset: MARKET_USDC, maxTimeoutSeconds: 1200,
    network: "near:mainnet", payTo: MARKET_PAYEE, scheme: "exact" };
  const signed = await payer.sign({ asset: MARKET_USDC, payTo: MARKET_PAYEE, amount: row.amount,
    nonce: 1n, maxBlockHeight: sim.chain.height + 1190n });
  const response = await fetch(`${sim.url}/a2a/worker/v1`, { method: "POST",
    headers: { "content-type": "application/json", "x-payment": paymentHeader(row, signed.signedDelegateAction) },
    body: JSON.stringify({ jsonrpc: "2.0", id: "fixture", method: "SendMessage", params: { message: { parts: [{ text: "Offline history fixture" }] } } }) });
  assert.equal(response.status, 200);
  const answer = await response.json() as any;
  assert.ok(answer.result?.task?.id, JSON.stringify(answer));
  return { id: answer.result.task.id as string, payer };
}

test("known owned assignments expose empty history; all deliverable reads enforce worker isolation", async () => {
  const sim = await market({ agents });
  try {
    const id = randomUUID();
    sim.assignments.set(id, { handle: "worker", assignment: { assignmentId: id, status: "in_progress" }, job: {} });
    const history = await get(sim, base(id) + "/versions");
    assert.equal(history.status, 200);
    assert.deepEqual(await history.json(), { versions: [] });
    for (const suffix of ["/versions", "/raw", "/versions/1/raw"]) {
      assert.equal((await get(sim, base(id) + suffix, "")).status, 401);
      assert.equal((await get(sim, base(id) + suffix, "other")).status, 403);
      assert.equal((await get(sim, base(randomUUID()) + suffix)).status, 404);
    }
    assert.equal((await get(sim, base(id) + "/raw")).status, 404);
    assert.equal((await get(sim, base(id) + "/versions/1/raw")).status, 404);
    assert.equal(sim.calls.some((c: any) => c.method === "POST"), false);
  } finally { await sim.close(); }
});

test("a delivered version survives a lost acknowledgement and fresh reads without resubmission or another payment", async () => {
  const sim = await market({ agents });
  try {
    const { id, payer } = await hire(sim);
    const markdown = "# Exact managed Markdown\nUnicode: café ☕\n";
    const response = await fetch(`${sim.url}/v1/assignments/${id}/submit`, { method: "POST",
      headers: { authorization: `Bearer ${sim.credentials("worker").token}`, "content-type": "application/json" },
      body: JSON.stringify({ deliverableMarkdown: markdown }) });
    assert.equal(response.status, 200);
    await response.body?.cancel(); // The client retains no submission acknowledgement.
    const versions = (await (await get(sim, base(id) + "/versions")).json() as any).versions;
    assert.equal(versions.length, 1);
    assert.deepEqual(versions[0], { version: 1, files: [], submittedAt: sim.assignments.get(id).assignment.submittedAt,
      deliverableHash: createHash("sha256").update(markdown).digest("hex"),
      deliverableUrl: base(id) + "/versions/1/raw", senderAgentId: sim.credentials("worker").agentId });
    assert.equal((await get(sim, base(id) + "/versions/1/raw")).headers.get("content-type"), "text/markdown; charset=utf-8");
    for (const suffix of ["/raw", "/versions/1/raw"]) assert.equal(await (await get(sim, base(id) + suffix)).text(), markdown);
    assert.equal((await get(sim, base(id) + "/versions/2/raw")).status, 404);
    assert.deepEqual((await (await get(sim, base(id) + "/versions")).json() as any).versions, versions);
    assert.equal(sim.chain.accounts.get(payer.account).transfers.length, 1);
    assert.equal(sim.calls.filter((c: any) => c.path.endsWith("/submit")).length, 1);
  } finally { await sim.close(); }
});

test("version history is append-only across fixture rework and never makes an expired payment paid", async () => {
  const sim = await market({ agents });
  try {
    const { id, payer } = await hire(sim);
    sim.advance(2000);
    const submit = (markdown: string) => fetch(`${sim.url}/v1/assignments/${id}/submit`, { method: "POST",
      headers: { authorization: `Bearer ${sim.credentials("worker").token}`, "content-type": "application/json" },
      body: JSON.stringify({ deliverableMarkdown: markdown }) });
    assert.equal((await submit("first version")).status, 200);
    const first = (await (await get(sim, base(id) + "/versions")).json() as any).versions[0];
    // Fixture-only rework: no provider review/acceptance endpoint is simulated by this mutation.
    sim.assignments.get(id).assignment.status = "in_progress";
    assert.equal((await submit("second version")).status, 200);
    const versions = (await (await get(sim, base(id) + "/versions")).json() as any).versions;
    assert.deepEqual(versions.map((v: any) => v.version), [1, 2]);
    assert.deepEqual(versions[0], first);
    assert.equal(await (await get(sim, base(id) + "/versions/1/raw")).text(), "first version");
    assert.equal(await (await get(sim, base(id) + "/versions/2/raw")).text(), "second version");
    assert.equal(await (await get(sim, base(id) + "/raw")).text(), "second version");
    assert.equal(sim.assignments.get(id).assignment.status, "submitted");
    assert.equal(sim.chain.accounts.get(payer.account).transfers.length, 0);
  } finally { await sim.close(); }
});
