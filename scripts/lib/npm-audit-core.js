'use strict';

function hasDirectAdvisory(vulnerability) {
  return Array.isArray(vulnerability?.via)
    && vulnerability.via.some((entry) => entry && typeof entry === 'object');
}

function isHighOrCritical(vulnerability) {
  return vulnerability?.severity === 'high' || vulnerability?.severity === 'critical';
}

function actionableVulnerabilities(vulnerabilities = {}) {
  return Object.values(vulnerabilities)
    .filter(isHighOrCritical)
    .filter(hasDirectAdvisory);
}

function inheritedHighCriticalCount(vulnerabilities = {}) {
  const all = Object.values(vulnerabilities).filter(isHighOrCritical);
  return all.length - actionableVulnerabilities(vulnerabilities).length;
}

module.exports = {
  actionableVulnerabilities,
  hasDirectAdvisory,
  inheritedHighCriticalCount,
  isHighOrCritical,
};
