'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * LOT 3 — Dashboard Canonical 360, réduction des angles morts de preuve.
 *
 * Couvre le défaut réel trouvé dans `parseOpenApiContract()` : la fonction
 * lisait `def['x-contract-status']` au niveau racine de l'opération OpenAPI,
 * alors que `scripts/contract-generate.js` n'écrit JAMAIS cette clé à cet
 * endroit — il l'écrit dans `responses.<code>.content.<type>.schema`, ou
 * dans `requestBody` pour le statut "joi". Résultat avant correction :
 * `def['x-contract-status']` valait `undefined` pour les 639 opérations du
 * contrat, donc TOUJOURS retombé sur `'UNKNOWN'`, et la comparaison à la
 * valeur littérale `'PROVEN'` plus loin ne pouvait jamais matcher (cette
 * valeur n'est d'ailleurs jamais écrite nulle part dans le contrat) — aucun
 * endpoint, même couvert par un vrai test d'intégration, ne pouvait sortir
 * `PROVEN`.
 *
 * `extractContractStatus()` et `isProvenStatus()` sont testées isolément
 * avec des formes d'opérations synthétiques — aucune route, fichier ou
 * module nommé en dur : uniquement la structure OpenAPI standard.
 */

const {
  extractContractStatus,
  isProvenStatus,
} = require('../../scripts/gen-dashboards-360-canonical');

describe('LOT 3 — extractContractStatus() retrouve le statut au bon endroit', () => {
  test('statut dans le schéma de la réponse 200 (forme la plus courante du contrat)', () => {
    const def = {
      responses: {
        200: { content: { 'application/json': { schema: { 'x-contract-status': 'test' } } } },
      },
    };
    expect(extractContractStatus(def)).toBe('test');
  });

  test('statut dans le schéma de la réponse 201 quand il n\'y a pas de 200', () => {
    const def = {
      responses: {
        201: { content: { 'application/json': { schema: { 'x-contract-status': 'route-read' } } } },
        429: { description: 'Too Many Requests' },
      },
    };
    expect(extractContractStatus(def)).toBe('route-read');
  });

  test('choisit le plus petit code 2xx si plusieurs réponses de succès existent', () => {
    const def = {
      responses: {
        204: { content: { 'application/json': { schema: { 'x-contract-status': 'service-read' } } } },
        200: { content: { 'application/json': { schema: { 'x-contract-status': 'test' } } } },
      },
    };
    expect(extractContractStatus(def)).toBe('test');
  });

  test('statut dans requestBody (joi) quand la réponse ne porte pas de statut', () => {
    const def = {
      requestBody: { 'x-contract-status': 'joi' },
      responses: { 200: { description: 'ok' } },
    };
    expect(extractContractStatus(def)).toBe('joi');
  });

  test('rétro-compatibilité : statut au niveau racine de l\'opération toujours accepté en priorité', () => {
    const def = {
      'x-contract-status': 'test',
      responses: { 200: { content: { 'application/json': { schema: { 'x-contract-status': 'route-read' } } } } },
    };
    expect(extractContractStatus(def)).toBe('test');
  });

  test('aucun statut nulle part → null, jamais une valeur inventée', () => {
    const def = { responses: { 200: { description: 'ok, sans schéma' } } };
    expect(extractContractStatus(def)).toBeNull();
  });

  test('opération vide ou malformée → null, ne jette jamais', () => {
    expect(extractContractStatus({})).toBeNull();
    expect(extractContractStatus(null)).toBeNull();
    expect(extractContractStatus(undefined)).toBeNull();
  });

  test('content-type autre que application/json (ex: text/html, application/pdf) toujours trouvé', () => {
    const def = {
      responses: {
        200: { content: { 'application/pdf': { schema: { type: 'string', format: 'binary', 'x-contract-status': 'route-read' } } } },
      },
    };
    expect(extractContractStatus(def)).toBe('route-read');
  });
});

describe('LOT 3 — isProvenStatus() : seul un vrai test sur le corps HTTP est une preuve', () => {
  test('"test" est prouvé', () => {
    expect(isProvenStatus('test')).toBe(true);
  });

  test('"route-read", "service-read", "joi", "scan-*" ne sont PAS prouvés (doctrine openapi.json : confiance < test)', () => {
    expect(isProvenStatus('route-read')).toBe(false);
    expect(isProvenStatus('service-read')).toBe(false);
    expect(isProvenStatus('joi')).toBe(false);
    expect(isProvenStatus('scan-boutique')).toBe(false);
  });

  test('null/undefined ne sont pas prouvés', () => {
    expect(isProvenStatus(null)).toBe(false);
    expect(isProvenStatus(undefined)).toBe(false);
  });

  test('ne marque jamais PROVEN par défaut : une valeur inconnue reste non prouvée', () => {
    expect(isProvenStatus('valeur-jamais-vue')).toBe(false);
  });
});

describe('LOT 3 — régression : le contrat réel ne doit plus s\'effondrer entièrement sur UNKNOWN', () => {
  test('le contrat OpenAPI réel contient au moins un statut "test" extrait à la bonne profondeur', () => {
    const fs = require('fs');
    const path = require('path');
    const openapi = JSON.parse(
      fs.readFileSync(path.join(__dirname, '../../docs/contract/openapi.json'), 'utf8')
    );
    let provenCount = 0;
    for (const methodsObj of Object.values(openapi.paths || {})) {
      for (const def of Object.values(methodsObj)) {
        if (isProvenStatus(extractContractStatus(def))) provenCount++;
      }
    }
    // Avant correction, ce compteur valait 0 pour la totalité du contrat
    // (639 opérations, 0 jamais "PROVEN"). Il doit maintenant refléter les
    // opérations réellement couvertes par un test d'intégration/unitaire.
    expect(provenCount).toBeGreaterThan(0);
  });
});
