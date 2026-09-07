'use strict';

const BLOCKING_SEVERITIES = new Set(['moderate', 'high', 'critical']);

function hasDirectAdvisory(vulnerability) {
  return Array.isArray(vulnerability?.via)
    && vulnerability.via.some((entry) => entry && typeof entry === 'object');
}

function isBlockingSeverity(vulnerability) {
  return BLOCKING_SEVERITIES.has(vulnerability?.severity);
}

function actionableVulnerabilities(vulnerabilities = {}) {
  return Object.values(vulnerabilities)
    .filter(isBlockingSeverity)
    .filter(hasDirectAdvisory);
}

function inheritedBlockingCount(vulnerabilities = {}) {
  const all = Object.values(vulnerabilities).filter(isBlockingSeverity);
  return all.length - actionableVulnerabilities(vulnerabilities).length;
}

module.exports = {
  actionableVulnerabilities,
  hasDirectAdvisory,
  inheritedBlockingCount,
  isBlockingSeverity,
};
