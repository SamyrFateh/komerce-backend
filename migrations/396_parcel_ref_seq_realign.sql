-- Réaligne parcel_ref_seq sur l'historique des références colis KOM-P-YYYY-NNNNNN (jamais en arrière).
-- Les références historiques non conformes (autre préfixe, suffixe non numérique) sont ignorées.
-- Idempotent : rejouable sans effet une fois la séquence au niveau.
DO $$
DECLARE
  hist bigint;
  cur bigint;
  called boolean;
BEGIN
  SELECT COALESCE(max(substring(reference FROM '^KOM-P-\d{4}-(\d{1,15})$')::bigint), 0)
    INTO hist FROM parcels WHERE reference ~ '^KOM-P-\d{4}-\d{1,15}$';
  SELECT last_value, is_called INTO cur, called FROM parcel_ref_seq;
  IF hist > 0 AND (hist > cur OR (hist = cur AND NOT called)) THEN
    PERFORM setval('parcel_ref_seq', hist, true);
  END IF;
END $$;
