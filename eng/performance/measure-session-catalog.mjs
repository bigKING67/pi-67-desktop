import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import {
  createSessionCatalog,
  normalizeSessionCatalogCwd
} from "../../packages/pi-runtime/dist/index.mjs";
import { resolveSampleCount } from "./performance-contract.mjs";
import {
  SESSION_CATALOG_NEEDLE_INDEX,
  SESSION_CATALOG_SIZES,
  assertMetadataOnlyRecords,
  createSessionCatalogContext,
  createSessionCatalogRecords
} from "./session-catalog-performance-fixture.mjs";
import { writeSessionCatalogPerformanceReport } from "./session-catalog-performance-report.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const sampleCount = resolveSampleCount();
const outputPath = process.env.PI67_PERF_SESSION_CATALOG_OUTPUT
  ?? join(root, "artifacts/performance", `session-catalog-${process.platform}-${process.arch}.json`);
const workspaceRoot = join(tmpdir(), "pi67-session-catalog-performance-workspace");
const pageLimit = 50;

const smallRecords = createSessionCatalogRecords(
  SESSION_CATALOG_SIZES.small,
  join(workspaceRoot, "small"),
  normalizeSessionCatalogCwd
);
const largeRecords = createSessionCatalogRecords(
  SESSION_CATALOG_SIZES.large,
  join(workspaceRoot, "large"),
  normalizeSessionCatalogCwd
);
assertMetadataOnlyRecords(smallRecords);
assertMetadataOnlyRecords(largeRecords);

const smallContext = createSessionCatalogContext(
  smallRecords,
  smallRecords[0].cwd,
  "session-catalog-performance:1000:v1"
);
const largeContext = createSessionCatalogContext(
  largeRecords,
  largeRecords[0].cwd,
  "session-catalog-performance:10000:v1"
);
const samples = {
  coldRebuild1k: [],
  coldRebuild10k: [],
  warmFirstPage1k: [],
  warmFirstPage10k: [],
  warmNextPage10k: [],
  searchHit10k: [],
  searchMiss10k: [],
  pageBytes10k: [],
  reopen10k: []
};

for (let sample = 0; sample < sampleCount; sample += 1) {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "pi67-session-catalog-performance-"));
  let smallCatalog;
  let largeCatalog;
  let reopenedCatalog;
  let releaseReopenReconcile;
  try {
    smallCatalog = createSessionCatalog({ directory: join(temporaryRoot, "small") });
    samples.coldRebuild1k.push(await measureDuration(() => smallCatalog.reconcile(smallContext)));
    assertSqliteReady(smallCatalog, SESSION_CATALOG_SIZES.small);

    const firstPage1k = await measureValue(() => smallCatalog.query({
      scope: "workspace",
      limit: pageLimit
    }, smallContext));
    samples.warmFirstPage1k.push(firstPage1k.durationMs);
    assertFirstPage(firstPage1k.value, SESSION_CATALOG_SIZES.small, smallRecords);

    largeCatalog = createSessionCatalog({ directory: join(temporaryRoot, "large") });
    samples.coldRebuild10k.push(await measureDuration(() => largeCatalog.reconcile(largeContext)));
    assertSqliteReady(largeCatalog, SESSION_CATALOG_SIZES.large);

    const firstPage10k = await measureValue(() => largeCatalog.query({
      scope: "workspace",
      limit: pageLimit
    }, largeContext));
    samples.warmFirstPage10k.push(firstPage10k.durationMs);
    assertFirstPage(firstPage10k.value, SESSION_CATALOG_SIZES.large, largeRecords);
    samples.pageBytes10k.push(Buffer.byteLength(JSON.stringify(firstPage10k.value), "utf8"));

    assert.ok(firstPage10k.value.nextCursor, "10,000-session first page must provide a next cursor.");
    const nextPage10k = await measureValue(() => largeCatalog.query({
      scope: "workspace",
      limit: pageLimit,
      cursor: firstPage10k.value.nextCursor
    }, largeContext));
    samples.warmNextPage10k.push(nextPage10k.durationMs);
    assertNextPage(nextPage10k.value, firstPage10k.value, largeRecords);

    const searchHit10k = await measureValue(() => largeCatalog.query({
      scope: "workspace",
      search: "needle 06789",
      limit: pageLimit
    }, largeContext));
    samples.searchHit10k.push(searchHit10k.durationMs);
    assert.equal(searchHit10k.value.total, 1, "Search-hit fixture must match exactly one session.");
    assert.equal(
      searchHit10k.value.items[0]?.id,
      largeRecords[SESSION_CATALOG_NEEDLE_INDEX].id,
      "Search-hit fixture returned the wrong session."
    );

    const searchMiss10k = await measureValue(() => largeCatalog.query({
      scope: "workspace",
      search: "no-session-catalog-match-zzzz",
      limit: pageLimit
    }, largeContext));
    samples.searchMiss10k.push(searchMiss10k.durationMs);
    assert.equal(searchMiss10k.value.total, 0, "Search-miss fixture unexpectedly matched a session.");
    assert.deepEqual(searchMiss10k.value.items, [], "Search-miss fixture must return an empty page.");

    await largeCatalog.dispose();
    reopenedCatalog = createSessionCatalog({ directory: join(temporaryRoot, "large") });
    const gatedReopen = createGatedReconcileContext(largeContext);
    releaseReopenReconcile = gatedReopen.release;
    const reopened10k = await measureValue(() => reopenedCatalog.query({
      scope: "workspace",
      limit: pageLimit
    }, gatedReopen.context));
    samples.reopen10k.push(reopened10k.durationMs);
    assertFirstPage(reopened10k.value, SESSION_CATALOG_SIZES.large, largeRecords);
    assert.equal(reopened10k.value.source, "sqlite", "Reopened catalog must use its SQLite projection.");

    // Keep the automatically scheduled rebuild outside the reopen timing window, then drain it.
    releaseReopenReconcile();
    releaseReopenReconcile = undefined;
    await reopenedCatalog.reconcile(gatedReopen.context);
    assertSqliteReady(reopenedCatalog, SESSION_CATALOG_SIZES.large);
  } finally {
    releaseReopenReconcile?.();
    await reopenedCatalog?.dispose();
    await largeCatalog?.dispose();
    await smallCatalog?.dispose();
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

await writeSessionCatalogPerformanceReport({ root, outputPath, samples });

async function measureDuration(operation) {
  const startedAt = performance.now();
  await operation();
  return performance.now() - startedAt;
}

async function measureValue(operation) {
  const startedAt = performance.now();
  const value = await operation();
  return { value, durationMs: performance.now() - startedAt };
}

function createGatedReconcileContext(context) {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  return {
    context: {
      ...context,
      discover: async () => {
        await gate;
        return context.discover();
      }
    },
    release
  };
}

function assertSqliteReady(catalog, expectedCount) {
  const status = catalog.status();
  assert.equal(status.source, "sqlite", "Performance evidence requires the real SQLite projection.");
  assert.equal(status.state, "ready", "SQLite projection must be ready before warm queries.");
  assert.equal(status.rebuilding, false, "Warm-query projection must not still be rebuilding.");
  assert.equal(status.itemCount, expectedCount, "SQLite projection item count does not match the fixture.");
  assert.equal(status.incomplete, false, "Complete metadata fixture must not produce an incomplete catalog.");
}

function assertFirstPage(page, expectedTotal, records) {
  assert.equal(page.source, "sqlite", "Session Catalog page must come from SQLite.");
  assert.equal(page.total, expectedTotal, "Session Catalog page total does not match the fixture.");
  assert.equal(page.itemCount, expectedTotal, "Session Catalog status item count does not match the fixture.");
  assert.equal(page.items.length, pageLimit, "Session Catalog first page must contain the requested item count.");
  assert.equal(page.hasMore, true, "Session Catalog first page must indicate more records.");
  assert.equal(page.items[0]?.id, records[0].id, "Session Catalog first page order is incorrect.");
  assert.equal(page.items.at(-1)?.id, records[pageLimit - 1].id, "Session Catalog first page boundary is incorrect.");
}

function assertNextPage(page, firstPage, records) {
  assert.equal(page.source, "sqlite", "Session Catalog next page must come from SQLite.");
  assert.equal(page.items.length, pageLimit, "Session Catalog next page must contain the requested item count.");
  assert.equal(page.items[0]?.id, records[pageLimit].id, "Session Catalog next-page order is incorrect.");
  assert.equal(page.items.at(-1)?.id, records[pageLimit * 2 - 1].id, "Session Catalog next-page boundary is incorrect.");
  const firstIds = new Set(firstPage.items.map((item) => item.id));
  assert.equal(page.items.some((item) => firstIds.has(item.id)), false, "Session Catalog pages must not overlap.");
}
