'use strict';

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((acc, key) => {
      acc[key] = sortKeys(value[key]);
      return acc;
    }, {});
  }
  return value;
}

function stableJSON(value) {
  return JSON.stringify(sortKeys(value), null, 2);
}

function witnessIds(doc) {
  return (doc?.snapshots || []).map(snapshot => snapshot.id).sort();
}

function sameWitnessSet(a, b) {
  return JSON.stringify(witnessIds(a)) === JSON.stringify(witnessIds(b));
}

function objectFingerprint(value) {
  return require('crypto')
    .createHash('sha256')
    .update(stableJSON(value))
    .digest('hex')
    .slice(0, 16);
}

function behaviorProjection(doc) {
  return {
    config_fingerprint: doc?.config_fingerprint || null,
    frozen_config: doc?.frozen_config || null,
    witness_count: doc?.witness_count ?? (doc?.snapshots || []).length,
    snapshots: doc?.snapshots || [],
  };
}

function behaviorFingerprint(doc) {
  return objectFingerprint(behaviorProjection(doc));
}

function buildTargetDocument(current, snapshots, generatedAt) {
  if (!current?.frozen_config) throw new Error('Golden CURRENT sans frozen_config');
  if (current.config_fingerprint !== objectFingerprint(current.frozen_config)) {
    throw new Error('Golden CURRENT: config_fingerprint incohérent avec frozen_config');
  }
  if (!Array.isArray(snapshots) || snapshots.length === 0) throw new Error('TARGET sans snapshots');

  const count = current.witness_count ?? (current.snapshots || []).length;
  if (snapshots.length !== count) {
    throw new Error(`TARGET witness_count invalide: ${snapshots.length} != ${count}`);
  }

  return {
    ...current,
    _kind: 'golden-cdr-target',
    _lot: '1B-1',
    _based_on_current_behavior: behaviorFingerprint(current),
    generated_at: generatedAt,
    witness_count: snapshots.length,
    snapshots,
  };
}

function assertPromotionPreconditions({ official, archive, target }) {
  if (!official || !archive || !target) throw new Error('Golden promotion: document manquant');
  if (target._kind !== 'golden-cdr-target') throw new Error('Golden promotion: TARGET invalide');
  if (target._lot !== '1B-1') throw new Error('Golden promotion: TARGET hors LOT 1B-1');

  const officialBehavior = behaviorFingerprint(official);
  const archiveBehavior = behaviorFingerprint(archive);
  if (officialBehavior !== archiveBehavior) {
    throw new Error(`Golden promotion: CURRENT officiel a dérivé (${officialBehavior} != ${archiveBehavior})`);
  }
  if (target._based_on_current_behavior !== archiveBehavior) {
    throw new Error('Golden promotion: TARGET ne dérive pas du CURRENT archivé');
  }
  if (archive.config_fingerprint !== objectFingerprint(archive.frozen_config)) {
    throw new Error('Golden promotion: fingerprint CURRENT incohérent avec frozen_config');
  }
  if (target.config_fingerprint !== objectFingerprint(target.frozen_config)) {
    throw new Error('Golden promotion: fingerprint TARGET incohérent avec frozen_config');
  }
  if (target.config_fingerprint !== archive.config_fingerprint) {
    throw new Error('Golden promotion: frozen_config/fingerprint différent entre CURRENT et TARGET');
  }
  if (!sameWitnessSet(archive, target)) {
    throw new Error('Golden promotion: ensemble de témoins différent entre CURRENT et TARGET');
  }

  return true;
}

function buildPromotedDocument(target, archive, promotedAt) {
  return {
    ...target,
    _kind: 'golden-cdr',
    _promoted_lot: '1B-1',
    _promoted_from: 'cdr.golden.target.1b1.json',
    _previous_current_behavior: behaviorFingerprint(archive),
    promoted_at: promotedAt,
    captured_at: target.generated_at || target.captured_at,
  };
}

module.exports = {
  sortKeys,
  stableJSON,
  witnessIds,
  sameWitnessSet,
  objectFingerprint,
  behaviorFingerprint,
  buildTargetDocument,
  assertPromotionPreconditions,
  buildPromotedDocument,
};
