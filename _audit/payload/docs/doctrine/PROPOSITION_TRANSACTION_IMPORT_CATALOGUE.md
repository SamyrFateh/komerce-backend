# Proposition — Modèle transactionnel de `catalog-import-orchestrator.js`

> **Statut : PROJET. Rien n'est exécuté, aucun fichier de production n'est modifié.**
> Chantier ING-6 · invariant ING-I9 · à valider avant écriture.

## 1. Ce que fait le code aujourd'hui

`services/suppliers/catalog-import-orchestrator.js` :

| Ligne | Comportement actuel | Conséquence |
|---|---|---|
| 66 | `if (!['csv','manual','api'].includes(sourceType))` → 400 | Un batch `json` meurt **avant** le connecteur. Le CHECK SQL `supplier_catalog_imports_source_type_check` le tuerait de toute façon à l'INSERT. |
| 76-77 | `connectorResult.products` / `.invalid` | La quarantaine n'existe pas dans l'interface consommée : 33 produits vidéo lus comme `undefined` ou perdus. |
| 83-85 | `if (!products.length) return 400` | Ce `return` est **avant** l'INSERT ligne 115. Un fichier 100 % vidéo ne laisse **aucune trace** : ni batch, ni quarantaine, ni motif. |
| 89 | `total = products.length + invalid.length` | La quarantaine n'entre dans aucun dénominateur : 33/82 = 40 % du fichier non représentable → `invalid_pct = 0 %` → « fichier sain ». |
| 115 | `INSERT INTO supplier_catalog_imports` | Le batch naît **après** tous les contrôles. |
| 122+ | `for (const product of products) { await db.query(...) }` | Aucune transaction. `import-product.js` utilise déjà `db.getClient()` / `BEGIN` / `COMMIT` : le pattern existe dans la maison, il n'est simplement pas appliqué ici. Une erreur au 30ᵉ produit laisse 29 candidats orphelins d'un batch présenté comme échoué. |

**Le défaut structurant n'est pas l'absence de transaction. C'est l'ordre.** Un batch qui naît après les contrôles ne peut pas tracer ce que les contrôles rejettent.

## 2. Flux cible

```
lecture du fichier
  → validation AJV du profil          ─┐ aucune source exploitable :
  → préflight de l'ENVELOPPE source    ─┤ rien à tracer SUR un batch,
  → calcul du hash source              ─┘ l'échec va au journal technique
  → INSERT batch PROCESSING            ← le batch existe avant TOUTE classification
  → classification produit par produit (pure, hors transaction DB)
  → BEGIN
      staging ready / quarantined / rejected
      calcul des seuils
      UPDATE statut final + compteurs
    COMMIT                              (ou ROLLBACK → batch FAILED)
```

**Correction apportée à la version précédente de ce document.** Elle appelait `dispatchToConnector()` — donc *toute* la classification des 82 produits — avant l'`INSERT`. Une exception imprévue au 30ᵉ produit ne laissait toujours aucune trace : le défaut d'origine, simplement déplacé de quelques lignes. Le connecteur doit donc être scindé à l'appel :

* `preflightSourceEnvelope()` + validation du profil → **avant** le batch, peuvent l'empêcher de naître ;
* `analyzeSourceRows()` → **après** le batch, ne peut plus rien empêcher, et toute exception y devient `FAILED` sur un batch réel.

Les seules erreurs autorisées à empêcher la naissance du batch sont celles où **aucune source exploitable n'existe** : profil absent ou AJV-invalide (`BATCH_CONFIGURATION_ERROR`), fichier illisible, JSON syntaxiquement invalide, racine non-objet, `products` absent ou non-tableau, fichier trop volumineux, nombre total au-delà de la limite, tableau vide interdit (`BATCH_SOURCE_FORMAT_ERROR`).

Un défaut de **ligne** n'en fait pas partie : identité absente ou dupliquée, champ trop gros, profondeur excessive, prix illisible, contrat AJV invalide → `rejected`, avec `reason_code`, `raw_payload` et `source_index`. Le batch continue et le seuil `max_invalid_pct` fait son travail (ING-I4).

Toute autre issue produit un batch réel, y compris `ready = 0`.

## 3. Esquisse

```js
async function importCatalog(body, userId, connector) {
  const sourceType = body.source_type || 'manual';
  if (!['csv', 'manual', 'api', 'json'].includes(sourceType)) {
    return { status: 400, body: { error: 'source_type doit être csv, manual, api ou json' } };
  }

  // ── Phase 1 — avant batch : rien à tracer si la source n'existe pas ──────
  let profile, source, sourceBytes, sourceSha256;
  try {
    ({ profile, source, sourceBytes, sourceSha256 } = await readSource(body));
    const profileCheck = resolveImportProfile(profile, { expectedSourceType: sourceType });
    if (!profileCheck.ok) throw batchError('BATCH_CONFIGURATION_ERROR', profileCheck.errors);
    const preflight = preflightSourceEnvelope(source, profile, { sourceBytes });
    if (!preflight.ok) throw batchError('BATCH_SOURCE_FORMAT_ERROR', preflight.errors);
  } catch (err) {
    logger.error({ code: err.code, errors: err.errors }, 'import refusé avant batch');
    return { status: 400, body: { error: err.message, code: err.code, errors: err.errors } };
  }

  // ── Phase 2 — naissance du batch : AVANT la classification ───────────────
  const importRes = await db.query(
    `INSERT INTO supplier_catalog_imports
       (supplier_name, source_type, source_filename, notes, total_items, imported_by,
        profile_id, profile_version, profile_hash, source_sha256, source_bytes,
        connector_name, connector_version, connector_contract_version, pipeline_version,
        status, started_at)
     VALUES ($1,$2,$3,$4,0,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'PROCESSING',now())
     RETURNING id`,
    [/* ... */]
  );
  const importId = importRes.rows[0].id;

  // ── Phase 3 — à partir d'ici, plus rien ne disparaît ─────────────────────
  let client;
  try {
    // Classification pure, hors transaction DB : elle ne lève pas pour une
    // ligne fautive. Si elle lève quand même, c'est un bug — et le batch
    // existe déjà pour le dire.
    const result = connector.classifyRows({ source, import_profile: profile });   // phase 2
    const { ready, quarantined, rejected, statistics, batchFindings } = result;

    client = await db.getClient();
    await client.query('BEGIN');

    for (const e of ready)       await stageCandidate(client, importId, e, 'normalized', profile);
    for (const e of quarantined) await stageCandidate(client, importId, e, 'quarantined', profile);
    for (const e of rejected)    await stageRejection(client, importId, e, profile);
    for (const e of [...ready, ...quarantined]) await stageObservation(client, importId, e, profile);

    // ── Seuils : deux populations, deux numérateurs, jamais mélangés ────────
    const te = statistics.threshold_evaluation;
    const status = te.invalid_exceeded     ? 'BLOCKED_INVALID_THRESHOLD'
                 : te.quarantined_exceeded ? 'BLOCKED_QUARANTINE_THRESHOLD'
                 : quarantined.length > 0  ? 'COMPLETED_WITH_QUARANTINE'
                 : 'COMPLETED';

    await client.query(
      `UPDATE supplier_catalog_imports
          SET status=$2, ready_count=$3, quarantined_count=$4, rejected_count=$5,
              invalid_pct=$6, quarantined_pct=$7, total_items=$8,
              batch_findings=$9, finished_at=now()
        WHERE id=$1`,
      [importId, status, statistics.ready, statistics.quarantined, statistics.rejected,
       statistics.invalid_pct, statistics.quarantined_pct, statistics.total,
       JSON.stringify(batchFindings)]
    );

    await client.query('COMMIT');
    return { status: 200, body: { import_id: importId, status, statistics } };
  } catch (err) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    // HORS transaction : le batch doit survivre à son propre échec.
    await db.query(
      `UPDATE supplier_catalog_imports
          SET status='FAILED', error_code=$2, error_detail=$3, finished_at=now()
        WHERE id=$1`,
      [importId, err.code || 'ERROR', String(err.message).slice(0, 2000)]
    );
    return { status: 500, body: { import_id: importId, status: 'FAILED', error: err.message } };
  } finally {
    if (client) client.release();
  }
}
```

Trois points non négociables dans cette esquisse :

* **L'`INSERT` du batch et l'`UPDATE ... FAILED` sont hors transaction.** Sinon le `ROLLBACK` effacerait la trace de son propre échec — exactement le défaut qu'on corrige.
* **Un batch bloqué par un seuil `COMMIT` quand même.** Le staging et le RAW sont conservés, les compteurs sont exacts, le statut est déterministe, aucune promotion n'a lieu. `BLOCKED_*` est un verdict, pas une panne. `ROLLBACK` ne s'applique qu'aux exceptions.
* **`ready = 0` n'est plus une erreur 400.** C'est un batch dont le verdict est `BLOCKED_QUARANTINE_THRESHOLD` ou `BLOCKED_INVALID_THRESHOLD`, intégralement tracé.

## 4. Variante par chunks — si les imports deviennent volumineux

À 82 produits, une transaction unique est le bon choix : simple, atomique, indiscutable. À 50 000 produits, elle tient un `ACCESS SHARE` prolongé, gonfle le WAL et rend tout échec maximalement coûteux.

Variante reprenable :

```
batch PROCESSING (une fois)
  → pour chaque chunk de N produits (N ≈ 500) :
      BEGIN
        staging du chunk (ON CONFLICT (supplier_name, supplier_product_id) DO UPDATE)
        UPDATE batch SET last_committed_chunk = k
      COMMIT
  → seuils calculés sur les compteurs agrégés
  → UPDATE statut final
```

Conditions pour que ce soit acceptable :

* **Idempotence par chunk** — `ON CONFLICT (supplier_name, supplier_product_id) DO UPDATE` pour les candidats, `ON CONFLICT (import_id, source_index) DO NOTHING` pour les rejets et les observations. Rejouer un chunk ne duplique rien. La clé d'identité du candidat reste inchangée ; c'est précisément ce qui rend la reprise possible.
* **Reprise** — `last_committed_chunk` permet de reprendre au chunk k+1. Les identifiants dupliqués ayant été **rejetés** (aucune occurrence élue), deux chunks ne se disputent jamais la même ligne de `sourcing_candidates`.
* **Jamais de statut mensonger** — un batch interrompu reste `PROCESSING`, jamais `COMPLETED*`. Un batch `PROCESSING` trop vieux est repris ou passé `FAILED` par un balai, jamais présenté comme réussi.

**Ce que la variante par chunks ne donne pas :** l'atomicité globale. Un batch repris est un batch partiellement observé à un instant t. Tant qu'aucune promotion n'a lieu depuis le staging, c'est sans conséquence — mais ça cesse de l'être dès qu'un mécanisme de promotion lira `state='normalized'` sans regarder `supplier_catalog_imports.status`. **Toute lecture du staging doit filtrer sur un batch terminé.** À trancher avant d'activer les chunks.

Recommandation : transaction unique maintenant, chunks quand un fournisseur réel dépassera quelques milliers de lignes. Ne pas payer la complexité avant d'en avoir le problème.

## 5. Ce qui reste ouvert

| Question | Pourquoi elle n'est pas tranchée ici |
|---|---|
| Lecture du staging par un futur promoteur | Doit filtrer sur `supplier_catalog_imports.status`. Sinon `BLOCKED_QUARANTINE_THRESHOLD` ne protège rien : un promoteur qui lit `state='normalized'` sans regarder le batch promouvrait les 49 lignes saines d'un fichier explicitement bloqué. **C'est le prochain point à trancher avant branchement.** |
| Backfill de `profile_id` sur les batchs historiques | La contrainte est `NOT VALID` : les lignes d'avant ING-6 n'ont pas de profil. `VALIDATE` exigerait de fabriquer un profil rétroactif — donc jamais. |
| `stageObservation` sur les lignes `rejected` | Une ligne rejetée est déjà intégralement tracée dans `supplier_catalog_import_rejections` (RAW compris). Une observation en plus la dupliquerait sans rien ajouter. À confirmer. |
