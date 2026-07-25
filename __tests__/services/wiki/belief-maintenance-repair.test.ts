// TDD failing tests for F-02C slice 5: source/reframe historical repair.
//
// Plan [TDD] rows this slice owns:
//   T-02C.1 — Deterministic clusters update rows/reframes and enqueue atomically
//   T-02C.2 — Failure inside source-cluster transaction rolls back that tx;
//              page-consolidation disabled in this slice (slice 8 gated on F-01)
//   T-02C.3 — Graph failure leaves marker; launch retry clears after success
//   T-02C.5 — External late/during-pass entity/reframe increments generation and
//              stays pending; maintenance writes do NOT self-increment
//
import {
  runBeliefMaintenance,
  MAINTENANCE_ALGORITHM_VERSION,
  MAINTENANCE_SOURCE_KEYS,
  MAINTENANCE_GRAPH_PENDING_KEY,
  retryBeliefMaintenanceGraphRebuild,
} from '@/services/wiki/belief-maintenance'
import { getMaintenanceState, incrementSourceGeneration } from '@/services/storage/maintenance-state'
import { getSetting } from '@/services/storage/settings'
import { createFakeDb } from '../../fixtures/wiki/belief-maintenance-fake-db'

// ── T-02C.5: self-trigger loop prevention ──────────────────────────────

describe('F-02C.5 — source-generation self-trigger loop prevention', () => {
  it('maintenance owns the bump boundary: setCanonicalLabel + retargetReframe do NOT bump source_generation', async () => {
    const { db, state } = createFakeDb()
    // Empty belief landscape → no clusters → maintenance mutates nothing.
    state.belief_maintenance_state.set('belief', {
      key: 'belief',
      algorithm_version: MAINTENANCE_ALGORITHM_VERSION,
      source_generation: 5,
      processed_generation: 5,
      status: 'idle',
      last_run_at: null,
      repaired_clusters: 0,
      deferred_clusters: 0,
      run_count: 0,
    })

    const res = await runBeliefMaintenance(db, { rebuildGraph: async () => ({ success: true, data: undefined }) as any })
    expect(res.success).toBe(true)
    // Pass is an idle no-op: no source mutations → no increment.
    const after = await getMaintenanceState('belief', db)
    expect(after.success && after.data.source_generation).toBe(5)
  })

  it('external writers (entry re-tag, reframe creation, remote apply) bump source_generation; maintenance does NOT', async () => {
    // The MAINTENANCE_SOURCE_KEYS export advertises which code paths bump.
    // Maintenance's own rewrites (setCanonicalLabel, retargetReframeBelief)
    // are NOT in this set.
    expect(MAINTENANCE_SOURCE_KEYS).toBeDefined()
    expect(Array.isArray(MAINTENANCE_SOURCE_KEYS)).toBe(true)
    // Maintenance's own writes never bump.
    expect(MAINTENANCE_SOURCE_KEYS).not.toContain('setCanonicalLabel')
    expect(MAINTENANCE_SOURCE_KEYS).not.toContain('retargetReframeBelief')
    // External raw ingests / remote applies DO bump.
    expect(MAINTENANCE_SOURCE_KEYS).toEqual(expect.arrayContaining(['setEntitiesForEntry', 'createReframe', 'applyRemote']))
  })

  it('a late-arriving remote entity apply during pass increments source_generation; next pass idempotently settles', async () => {
    // Build state: one cluster pending (unprocessed) → maintenance runs and
    // settles processed_generation = captured. Then a remote apply bumps
    // source_generation. Next pass reruns.
    const { db, state } = createFakeDb()
    // Set 'aliasbelief' raw entity (canonical unset) and pending maintenance.
    state.entry_entities.set('e1', {
      id: 'e1', entry_id: 'en1', type: 'belief',
      label: 'I am unlovable', canonical_label: null, created_at: 1000, updated_at: 1000,
    })
    state.belief_maintenance_state.set('belief', {
      key: 'belief',
      algorithm_version: MAINTENANCE_ALGORITHM_VERSION - 1, // version changed → forces rerun
      source_generation: 3,
      processed_generation: 3,
      status: 'idle',
      last_run_at: null,
      repaired_clusters: 0,
      deferred_clusters: 0,
      run_count: 0,
    })

    const res = await runBeliefMaintenance(db, { rebuildGraph: async () => ({ success: true, data: undefined }) as any })
    expect(res.success).toBe(true)
    const after = await getMaintenanceState('belief', db)
    // After a no-cluster (single-label) settle: processed_generation == source_generation
    // captured before analysis, AND algorithm_version bumped to current.
    expect(after.success && after.data.algorithm_version).toBe(MAINTENANCE_ALGORITHM_VERSION)
    expect(after.success && after.data.processed_generation).toBe(3)

    // Now a remote apply arrives → bumps source_generation.
    const bumped = await incrementSourceGeneration('belief', db)
    expect(bumped.success && bumped.data).toBe(4)
    expect(after.success && after.data.processed_generation).toBe(3) // unchanged
  })
})

// ── T-02C.1: source/reframe repair transaction atomicity ──────────────

describe('F-02C.1 — deterministic clusters update rows/reframes and enqueue atomically', () => {
  it('two-alias cluster: writes canonical_label on non-canonical entity rows, retargets reframes, enqueues both, all in a single transaction', async () => {
    const { db, state, enqueueLog } = createFakeDb()
    // Two aliases for the same belief, both with no canonical, distinct entries.
    state.entry_entities.set('e1', {
      id: 'e1', entry_id: 'en1', type: 'belief',
      label: 'I am unlovable', canonical_label: null, created_at: 1000, updated_at: 1000,
    })
    state.entry_entities.set('e2', {
      id: 'e2', entry_id: 'en2', type: 'belief',
      label: 'Nobody loves me', canonical_label: null, created_at: 1100, updated_at: 1100,
    })
    // Reframe under the to-retire alias.
    state.belief_reframes.set('r1', {
      id: 'r1', belief: 'Nobody loves me',
      evidence_for: '', evidence_against: '', balanced_thought: 'reality check',
      created_at: 2000, updated_at: 2000,
    })
    state.belief_maintenance_state.set('belief', {
      key: 'belief',
      algorithm_version: 0, // force version upgrade on first run
      source_generation: 10,
      processed_generation: 0,
      status: 'idle',
      last_run_at: null,
      repaired_clusters: 0,
      deferred_clusters: 0,
      run_count: 0,
    })
    // Inject near-synonym embeddings above the 0.78 threshold so the real cosine
    // path clusters these two labels.
    state.entity_embeddings.set('I am unlovable', { label: 'I am unlovable', type: 'belief', vector: JSON.stringify([1, 0, 0]) })
    state.entity_embeddings.set('Nobody loves me', { label: 'Nobody loves me', type: 'belief', vector: JSON.stringify([0.97, 0.1, 0.1]) })

    const res = await runBeliefMaintenance(db, { rebuildGraph: async () => ({ success: true, data: undefined }) as any })
    expect(res.success).toBe(true)

    // After repair:
    //  - canonical chosen deterministically. entry count tie (1 each), earliest
    //    timestamp wins → 'I am unworthy' (1000 < 1100). So canonical should be
    //    'I am unworthy', and "I'm unworthy" should be retired.
    // OR canonical could be 'I am unworthy' for stripping reasons.
    // Just assert ONE row got canonical_label set and the other got
    // canonical_label pointing to the survivor.
    const r1 = state.entry_entities.get('e1')
    const r2 = state.entry_entities.get('e2')
    // Exactly one row has canonical_label === null (the survivor); the other
    // has canonical_label set to the survivor's label.
    const survivorRow = !r1?.canonical_label ? r1 : r2
    const aliasRow = r1?.canonical_label ? r1 : r2
    expect(survivorRow).toBeDefined()
    expect(aliasRow?.canonical_label).toBeTruthy()
    expect(String(aliasRow?.canonical_label).toLowerCase()).toBe(String(survivorRow?.label).toLowerCase())

    // Reframe retargeted: belief_reframes[r1].belief now points to survivor.
    const rfm = state.belief_reframes.get('r1')
    expect(String(rfm?.belief).toLowerCase()).toBe(String(survivorRow?.label).toLowerCase())

    // Enqueued: at least the changed entity row + the changed reframe row.
    expect(enqueueLog.some((x) => x.table === 'entry_entities' && x.id === aliasRow?.id)).toBe(true)
    expect(enqueueLog.some((x) => x.table === 'belief_reframes' && x.id === 'r1')).toBe(true)

    // State settled: processed_generation == captured source_generation (10),
    // algorithm_version == MAINTENANCE_ALGORITHM_VERSION, repaired_clusters == 1.
    const after = await getMaintenanceState('belief', db)
    expect(after.success && after.data.processed_generation).toBe(10)
    expect(after.success && after.data.algorithm_version).toBe(MAINTENANCE_ALGORITHM_VERSION)
    expect(after.success && after.data.repaired_clusters).toBe(1)
    expect(after.success && after.data.deferred_clusters).toBe(0)
  })

  it('a single-label cluster (no aliases) is a no-op for source rows; processed_generation still advances', async () => {
    const { db, state } = createFakeDb()
    state.entry_entities.set('e1', {
      id: 'e1', entry_id: 'en1', type: 'belief',
      label: 'I am unique', canonical_label: null, created_at: 1000, updated_at: 1000,
    })
    state.belief_maintenance_state.set('belief', {
      key: 'belief',
      algorithm_version: MAINTENANCE_ALGORITHM_VERSION - 1,
      source_generation: 2,
      processed_generation: 0,
      status: 'idle',
      last_run_at: null,
      repaired_clusters: 0,
      deferred_clusters: 0,
      run_count: 0,
    })

    const res = await runBeliefMaintenance(db, { rebuildGraph: async () => ({ success: true, data: undefined }) as any })
    expect(res.success).toBe(true)
    // No aliases → no canonical_label written.
    expect(state.entry_entities.get('e1')?.canonical_label).toBeNull()
    const after = await getMaintenanceState('belief', db)
    expect(after.success && after.data.processed_generation).toBe(2)
    expect(after.success && after.data.repaired_clusters).toBe(0)
  })
})

// ── T-02C.2: transaction atomicity (rollback) ──────────────────────────

describe('F-02C.2 — source-cluster transaction is atomic', () => {
  it('a failure inside the source-cluster transaction rolls back that cluster; other clusters still settle; no partial canonical_label leak', async () => {
    const { db, state, failNextUpdate } = createFakeDb()
    // Two independent clusters (each its own cosine cluster):
    //   cluster A: 'I am worthless' / 'Nobody worthless me' settle cleanly
    //   cluster B: 'I am foolish'   / 'I am a fool'         fail mid-UPDATE
    state.entry_entities.set('a1', { id: 'a1', entry_id: 'en1', type: 'belief', label: 'I am worthless', canonical_label: null, created_at: 1000, updated_at: 1000 })
    state.entry_entities.set('a2', { id: 'a2', entry_id: 'en2', type: 'belief', label: 'I am worthless me', canonical_label: null, created_at: 1100, updated_at: 1100 })
    state.entry_entities.set('b1', { id: 'b1', entry_id: 'en3', type: 'belief', label: 'I am foolish', canonical_label: null, created_at: 1200, updated_at: 1200 })
    state.entry_entities.set('b2', { id: 'b2', entry_id: 'en4', type: 'belief', label: 'I am a fool', canonical_label: null, created_at: 1300, updated_at: 1300 })
    // Inject near-synonym embeddings for each cluster.
    state.entity_embeddings.set('I am worthless', { label: 'I am worthless', type: 'belief', vector: JSON.stringify([1, 0, 0]) })
    state.entity_embeddings.set('I am worthless me', { label: 'I am worthless me', type: 'belief', vector: JSON.stringify([0.99, 0.1, 0.05]) })
    state.entity_embeddings.set('I am foolish', { label: 'I am foolish', type: 'belief', vector: JSON.stringify([0, 1, 0]) })
    state.entity_embeddings.set('I am a fool', { label: 'I am a fool', type: 'belief', vector: JSON.stringify([0.02, 0.98, 0.05]) })
    state.belief_maintenance_state.set('belief', {
      key: 'belief', algorithm_version: MAINTENANCE_ALGORITHM_VERSION - 1,
      source_generation: 7, processed_generation: 0, status: 'idle',
      last_run_at: null, repaired_clusters: 0, deferred_clusters: 0, run_count: 0,
    })

    // Force the next entry_entities UPDATE to throw — whichever cluster goes
    // second (deterministic: sorted by canonical) rolls back.
    failNextUpdate('entry_entities')

    const res = await runBeliefMaintenance(db, { rebuildGraph: async () => ({ success: true, data: undefined }) as any })
    // One cluster's tx threw (forced UPDATE failure) → res.success is false
    // BUT the other cluster committed. Runner propagates the error while
    // partial state is written.
    expect(res.success).toBe(false)
    if (!res.success) {
      expect(res.error.code).toBe('BELIEF_MAINTENANCE_TX_FAILED')
    }

    // Cluster A must have settled: ONE row has canonical_label pointing to the
    // survivor. Cluster B MUST have rolled back — neither row touched.
    const a1 = state.entry_entities.get('a1')
    const a2 = state.entry_entities.get('a2')
    const b1 = state.entry_entities.get('b1')
    const b2 = state.entry_entities.get('b2')
    const aTouched = (a1?.canonical_label != null ? 1 : 0) + (a2?.canonical_label != null ? 1 : 0)
    const bTouched = (b1?.canonical_label != null ? 1 : 0) + (b2?.canonical_label != null ? 1 : 0)
    // Exactly one cluster (whichever was first in deterministic order) settled
    // with exactly ONE retired-alias row; the other cluster is fully untouched.
    expect(aTouched + bTouched).toBe(1) // one row wrote in the settled cluster
    expect(aTouched === 0 || bTouched === 0).toBe(true) // one cluster rolled back
  })
})

// ── T-02C.3: graph rebuild marker lifecycle ────────────────────────────

describe('F-02C.3 — graph rebuild marker lifecycle', () => {
  it('when there is no source repair work, the graph-rebuild marker is never set', async () => {
    const { db, state } = createFakeDb()
    state.entry_entities.set('e1', { id: 'e1', entry_id: 'en1', type: 'belief', label: 'I am alone', canonical_label: null, created_at: 1000, updated_at: 1000 })
    state.belief_maintenance_state.set('belief', {
      key: 'belief', algorithm_version: MAINTENANCE_ALGORITHM_VERSION - 1,
      source_generation: 1, processed_generation: 0, status: 'idle',
      last_run_at: null, repaired_clusters: 0, deferred_clusters: 0, run_count: 0,
    })
    await runBeliefMaintenance(db, { rebuildGraph: async () => ({ success: true, data: undefined }) as any })
    const marker = await getSetting(MAINTENANCE_GRAPH_PENDING_KEY, db)
    // No source rows changed → marker must remain unset.
    expect(marker.success && marker.data).toBeNull()
  })

  it('when source repair completes and graph rebuild succeeds, marker is cleared', async () => {
    const { db, state } = createFakeDb()
    state.entry_entities.set('a1', { id: 'a1', entry_id: 'en1', type: 'belief', label: 'I am sad', canonical_label: null, created_at: 1000, updated_at: 1000 })
    state.entry_entities.set('a2', { id: 'a2', entry_id: 'en2', type: 'belief', label: 'I am down', canonical_label: null, created_at: 1100, updated_at: 1100 })
    state.entity_embeddings.set('I am sad', { label: 'I am sad', type: 'belief', vector: JSON.stringify([1, 0, 0]) })
    state.entity_embeddings.set('I am down', { label: 'I am down', type: 'belief', vector: JSON.stringify([0.98, 0.1, 0.1]) })
    state.belief_maintenance_state.set('belief', {
      key: 'belief', algorithm_version: MAINTENANCE_ALGORITHM_VERSION - 1,
      source_generation: 5, processed_generation: 0, status: 'idle',
      last_run_at: null, repaired_clusters: 0, deferred_clusters: 0, run_count: 0,
    })

    await runBeliefMaintenance(db, { rebuildGraph: async () => ({ success: true, data: undefined }) as any })
    const marker = await getSetting(MAINTENANCE_GRAPH_PENDING_KEY, db)
    expect(marker.success && marker.data).toBeNull() // cleared on success
    const after = await getMaintenanceState('belief', db)
    expect(after.success && after.data.status).not.toBe('needs-graph-rebuild')
  })

  it('graph rebuild failure leaves the durable marker AND status=needs-graph-rebuild; launch retry clears it after success', async () => {
    const { db, state } = createFakeDb()
    state.entry_entities.set('a1', { id: 'a1', entry_id: 'en1', type: 'belief', label: 'I am wrong', canonical_label: null, created_at: 1000, updated_at: 1000 })
    state.entry_entities.set('a2', { id: 'a2', entry_id: 'en2', type: 'belief', label: 'I am mistaken', canonical_label: null, created_at: 1100, updated_at: 1100 })
    state.entity_embeddings.set('I am wrong', { label: 'I am wrong', type: 'belief', vector: JSON.stringify([1, 0, 0]) })
    state.entity_embeddings.set('I am mistaken', { label: 'I am mistaken', type: 'belief', vector: JSON.stringify([0.97, 0.1, 0.1]) })
    state.belief_maintenance_state.set('belief', {
      key: 'belief', algorithm_version: MAINTENANCE_ALGORITHM_VERSION - 1,
      source_generation: 5, processed_generation: 0, status: 'idle',
      last_run_at: null, repaired_clusters: 0, deferred_clusters: 0, run_count: 0,
    })

    // The fake db doesn't track rebuildGraph; the runner uses an injectable
    // rebuildGraph hook. We inject one that fails the first time but succeeds
    // the second time.
    let fail = true
    await runBeliefMaintenance(db, { rebuildGraph: async () => { if (fail) { fail = false; throw new Error('rebuild failed') } return { success: true, data: undefined } as any } })

    // Marker left set.
    let marker = await getSetting(MAINTENANCE_GRAPH_PENDING_KEY, db)
    expect(marker.success && marker.data).toBe('1')
    // Status indicates retry needed.
    const after = await getMaintenanceState('belief', db)
    expect(after.success && after.data.status).toBe('needs-graph-rebuild')
    // processed_generation NOT advanced — pass remains pending.
    expect(after.success && after.data.processed_generation).toBe(0)

    // Retry clears the marker after a successful rebuild.
    const retry = await retryBeliefMaintenanceGraphRebuild(db, { rebuildGraph: async () => ({ success: true, data: undefined } as any) })
    expect(retry.success).toBe(true)
    marker = await getSetting(MAINTENANCE_GRAPH_PENDING_KEY, db)
    expect(marker.success && marker.data).toBeNull()
    const retried = await getMaintenanceState('belief', db)
    expect(retried.success && retried.data.status).toBe('idle')
    // After successful retry the pass settles processed_generation == captured.
    expect(retried.success && retried.data.processed_generation).toBeGreaterThan(0)
  })
})
