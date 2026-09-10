-- @migration 211_staging_cm_cg_relay_projection.sql
-- @domain    market,logistics
-- @purpose   Réparer uniquement les fixtures SEEDTEST CM/CG déjà présentes :
--            leur projection publique doit porter une ville locale et jamais
--            une géographie insulaire KM. Aucune création de donnée : en prod
--            sans fixture SEEDTEST, cette migration est un no-op.
--
-- Doctrine : depuis migration 200, relais.island est nullable et non applicable
-- hors marchés insulaires. CM/CG utilisent zone pour la ville ; island reste NULL.

WITH ranked AS (
  SELECT
    r.id,
    m.code,
    ROW_NUMBER() OVER (
      PARTITION BY m.code
      ORDER BY
        CASE
          WHEN m.code = 'CM' AND r.name = 'Relais Komerce Yaoundé Centre' THEN 0
          WHEN m.code = 'CG' AND r.name = 'Relais Komerce Brazzaville Centre' THEN 0
          ELSE 1
        END,
        r.id
    ) AS rn
  FROM relais r
  JOIN markets m ON m.id = r.market_id
  WHERE m.code IN ('CM', 'CG')
    AND (
      r.name ILIKE 'SEEDTEST%'
      OR r.name IN ('Relais Komerce Yaoundé Centre', 'Relais Komerce Brazzaville Centre')
    )
), canonical AS (
  SELECT id, code
  FROM ranked
  WHERE rn = 1
)
UPDATE relais r
SET
  name = CASE c.code
    WHEN 'CM' THEN 'Relais Komerce Yaoundé Centre'
    WHEN 'CG' THEN 'Relais Komerce Brazzaville Centre'
  END,
  agent_name = COALESCE(NULLIF(r.agent_name, ''), 'Komerce Staging'),
  address = CASE c.code
    WHEN 'CM' THEN 'Yaoundé Centre, Cameroun'
    WHEN 'CG' THEN 'Brazzaville Centre, Congo'
  END,
  zone = CASE c.code
    WHEN 'CM' THEN 'Yaoundé'
    WHEN 'CG' THEN 'Brazzaville'
  END,
  island = NULL,
  is_active = TRUE
FROM canonical c
WHERE r.id = c.id;

-- Les anciennes fixtures publiques du même marché restent en base pour leurs FK,
-- mais ne doivent plus être proposées au checkout.
UPDATE relais r
SET is_active = FALSE
FROM markets m
WHERE m.id = r.market_id
  AND m.code IN ('CM', 'CG')
  AND r.name ILIKE 'SEEDTEST%';
