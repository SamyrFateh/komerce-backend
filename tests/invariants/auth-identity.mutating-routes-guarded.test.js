'use strict';

/**
 * Invariant #1 (P1) — transcrit tel quel depuis features/auth-identity.feature.js :
 *
 *   « toute route mutante passe par un middleware d'auth déclaré — jamais
 *     d'accès direct sans garde »
 *
 * Ce test NE réinterprète PAS l'invariant : il transcrit la formulation
 * existante en assertion exécutable, rien de plus. Deux choses viennent du
 * dépôt, pas de ce fichier :
 *
 *   1. Le périmètre — exactement les routes du `contract.exposes` du
 *      manifeste (routes/auth.js, routes/otp.js, routes/client-auth.js
 *      d'après `files.routes`), jamais l'app entière.
 *   2. Les exceptions — le manifeste documente LUI-MÊME, dans son propre
 *      champ `security.note`, quelles routes sont publiques PAR CONCEPTION
 *      et pourquoi (OTP gaté par cooldown + plafond DB, magic-link à token
 *      signé, guest-checkout = flux boutique public, orders-by-phone =
 *      lookup client public, admin-reset gaté applicativement par
 *      ADMIN_RESET_KEY + ALLOW_ADMIN_RESET). PUBLIC_BY_DESIGN ci-dessous
 *      transcrit cette liste déjà nommée — aucune exception n'est ajoutée
 *      qui ne soit pas déjà documentée dans `security.note`.
 *
 * Preuve mesurée à l'écriture de ce test (voir security.note du manifeste) :
 * 7 routes protégées, 13 publiques par conception, sur 20 déclarées.
 */

const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const featureManifest = require(path.join(ROOT, 'features/auth-identity.feature.js'));

// Transcription 1:1 des routes que security.note nomme déjà publiques par
// conception — ne pas ajouter d'entrée qui n'y figure pas explicitement.
// NB (trouvé par le contrôle R2 ci-dessous) : on n'utilise PAS le niveau
// "PUBLIC" calculé par gen-security-360.js comme preuve suffisante — sa
// regex PUBLIC_OK matche `/^\/api\/auth\/me/` sans distinguer la méthode,
// donc classerait un PUT /api/auth/me dégarni en "PUBLIC" au lieu
// d'"UNPROTECTED", masquant une régression. Ce test reste donc strict :
// PROTECTED (garde authn détectée) ou explicitement listé ici — jamais le
// niveau PUBLIC de l'outil amont pris tel quel. login/register/logout sont
// inclus ici car ce sont, par définition, les points d'entrée avant
// authentification — cohérent avec le compte « 13 routes publiques par
// design » de security.note (3 OTP + 4 magic-link dont 2 GET hors scope
// mutant + guest-checkout + orders-by-phone + admin-reset + login +
// register + logout = 13).
const PUBLIC_BY_DESIGN = new Set([
  'POST /api/auth/otp/request',      // cooldown 5 min/phone + plafond journalier DB
  'POST /api/auth/otp/verify',       // idem, vérif OTP elle-même
  'POST /api/auth/otp/test-reset',   // gaté par isOtpTestMode() → 404 en prod
  'POST /api/auth/magic-link',       // token signé
  'POST /api/client/magic-link',     // idem, alias client
  'POST /api/auth/guest-checkout',   // flux boutique public
  'POST /api/auth/orders-by-phone',  // client lookup public
  'POST /api/auth/admin-reset',      // gaté applicativement (ADMIN_RESET_KEY + ALLOW_ADMIN_RESET)
  'POST /api/auth/login',            // point d'entrée avant authentification, par définition
  'POST /api/auth/register',         // idem
  'POST /api/auth/logout',           // idem — invalide une session, n'en exige pas une valide
]);

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

describe('invariant auth-identity — toute route mutante passe par un middleware d\'auth déclaré', () => {
  let bySecurityKey;

  beforeAll(() => {
    // Régénère docs/SECURITY_360.json depuis le CODE RÉEL (mode gen, exit 0
    // systématique) — jamais depuis un artefact potentiellement périmé.
    execFileSync('node', ['scripts/gen-security-360.js'], { cwd: ROOT, stdio: 'pipe' });
    delete require.cache[require.resolve(path.join(ROOT, 'docs/SECURITY_360.json'))];
    const report = require(path.join(ROOT, 'docs/SECURITY_360.json'));
    bySecurityKey = new Map(report.routes.map((r) => [r.key, r]));
  });

  const declaredMutatingRoutes = featureManifest.contract.exposes
    .map((entry) => {
      const [method, routePath] = entry.split(' ');
      return { method, routePath };
    })
    .filter(({ method }) => MUTATING.has(method));

  // Garde-fou : si le contrat de la feature change et n'a plus aucune route
  // mutante, ce test se tairait silencieusement — on refuse ce silence.
  test('le contrat de la feature déclare au moins une route mutante à vérifier', () => {
    expect(declaredMutatingRoutes.length).toBeGreaterThan(0);
  });

  test.each(declaredMutatingRoutes.map(({ method, routePath }) => [method, routePath]))(
    '%s %s est gardée par un middleware d\'auth, ou documentée publique par conception',
    (method, routePath) => {
      const key = `${method} ${routePath}`;

      if (PUBLIC_BY_DESIGN.has(key)) {
        // Route déjà déclarée publique par conception dans security.note du
        // manifeste — aucune garde exigée, rien d'autre à prouver ici.
        return;
      }

      const found = bySecurityKey.get(key);
      expect(found).toBeDefined();
      // Strict : PROTECTED (garde authn réellement détectée dans le code).
      // Le niveau "PUBLIC" de gen-security-360.js n'est jamais accepté ici
      // tel quel (voir note R2 sur PUBLIC_BY_DESIGN plus haut) — seule la
      // liste transcrite explicitement fait foi pour les routes publiques.
      expect(found.level === 'PROTECTED').toBe(true);
    }
  );
});
