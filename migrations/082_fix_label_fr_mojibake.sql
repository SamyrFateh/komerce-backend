-- Corrige le mojibake sur label_fr (encodage corrompu insere avant la
-- correction du seed dans 033_parametres_extension.sql).
-- Le seed original utilisait ON CONFLICT DO NOTHING : les lignes deja
-- presentes en base n'ont jamais ete remplacees par les valeurs corrigees.

UPDATE pricing_category_taxes
SET label_fr = 'Électronique'
WHERE category = 'electronique' AND label_fr <> 'Électronique';

UPDATE pricing_category_taxes
SET label_fr = 'Mode & Beauté'
WHERE category = 'mode_beaute' AND label_fr <> 'Mode & Beauté';

UPDATE pricing_category_dims
SET label_fr = 'Électronique'
WHERE category = 'electronique' AND label_fr <> 'Électronique';

UPDATE pricing_category_dims
SET label_fr = 'Mode & Beauté'
WHERE category = 'mode_beaute' AND label_fr <> 'Mode & Beauté';
