-- Migration 244 — curated Komerce glossary decisions from FR Quality Pass batch 001
--
-- These entries are NOT a raw TERMIUM import. They are Komerce editorial
-- decisions made after comparing the real CJ source corpus with TERMIUM
-- references and the target French storefront vocabulary.
--
-- Important: prefer multi-word phrases when a one-word source term would be
-- dangerously ambiguous across product domains.

INSERT INTO catalog_glossary (term_source, term_fr, note, is_active)
VALUES
  ('leggings', 'legging',
   'Vêtement — terme commercial français retenu par Komerce ; TERMIUM propose aussi « jambières », non retenu pour le catalogue e-commerce.', TRUE),

  ('digital printing', 'impression numérique',
   'Impression — confirmé TERMIUM dans plusieurs domaines.', TRUE),

  ('three-quarter sleeve', 'manche trois-quarts',
   'Vêtement — formulation française canonique ; confirmé TERMIUM couture.', TRUE),

  ('high waist', 'taille haute',
   'Vêtement — coupe/taille.', TRUE),

  ('stud earrings', 'puces d''oreilles',
   'Bijouterie — vocabulaire client Komerce ; TERMIUM propose « boutons d''oreille », jugé moins naturel pour le storefront.', TRUE),

  ('electroplating', 'électroplacage',
   'Métallurgie/bijouterie — confirmé TERMIUM. Ne pas transformer en « plaqué or » sans mention explicite du métal de dépôt.', TRUE),

  ('titanium steel', 'acier titane',
   'Fournisseur — traduction littérale conservatrice. Ne jamais inférer « titane massif » ni « acier inoxydable » sans preuve source.', TRUE),

  ('business casual', 'tenue de ville décontractée',
   'Vêtement — confirmé TERMIUM Clothing (General).', TRUE),

  ('size chart', 'guide des tailles',
   'Vêtement — préférence éditoriale Komerce ; TERMIUM fournit selon contexte « tableau des tailles » / « tableau des pointures ».', TRUE),

  ('polyester fiber', 'fibre de polyester',
   'Textile — confirmé TERMIUM matières premières industrielles.', TRUE),

  ('cotton blend', 'mélange coton',
   'Textile — confirmé TERMIUM industrie du coton/textile.', TRUE),

  ('solid color', 'coloris uni',
   'Vêtement — préférence storefront. Ne pas utiliser la traduction littérale « couleur solide ».', TRUE),

  ('stand collar', 'col montant',
   'Vêtement — col.', TRUE),

  ('quick-drying', 'séchage rapide',
   'Textile/sport — propriété fonctionnelle ; ne conserver que si la source l''affirme.', TRUE),

  ('moisture-wicking', 'évacuation de l''humidité',
   'Textile/sport — propriété fonctionnelle ; ne conserver que si la source l''affirme.', TRUE),

  ('bell sleeve', 'manches cloche',
   'Vêtement — coupe de manche.', TRUE),

  ('half-zip', 'demi-zip',
   'Vêtement — fermeture partielle zippée.', TRUE),

  ('bodycon', 'moulant',
   'Vêtement — coupe près du corps.', TRUE),

  ('seamless', 'sans coutures',
   'Vêtement uniquement — TERMIUM confirme « sans couture » dans Clothing Accessories ; ne pas appliquer aux câbles/objets soudés.', TRUE),

  ('v-neck', 'col V',
   'Vêtement — encolure.', TRUE),

  ('long sleeve', 'manches longues',
   'Vêtement — longueur de manche.', TRUE),

  ('short sleeve', 'manches courtes',
   'Vêtement — longueur de manche.', TRUE),

  ('backless', 'dos nu',
   'Vêtement — coupe.', TRUE),

  ('straight-leg pants', 'pantalon droit',
   'Vêtement — coupe de pantalon.', TRUE),

  ('wide-leg pants', 'pantalon à jambes larges',
   'Vêtement — coupe de pantalon ; le titre client peut être raccourci en « pantalon ample » si le sens reste exact.', TRUE),

  ('tie-dye', 'tie-dye',
   'Textile — terme commercial français retenu ; TERMIUM propose « teint au nœud », trop technique pour le storefront.', TRUE),

  ('hollow out', 'ajouré',
   'Mode/bijouterie uniquement — éviter le terme générique « hollow », trop polysémique dans TERMIUM.', TRUE),

  ('925 silver', 'argent 925',
   'Bijouterie — ne l''affirmer que lorsque la variante/matière source porte réellement 925 Silver.', TRUE),

  ('white gold color', 'coloris or blanc',
   'Bijouterie — couleur/finition seulement ; ne jamais convertir en matière « or blanc » sans preuve.', TRUE),

  ('yellow gold color', 'coloris or jaune',
   'Bijouterie — couleur/finition seulement ; ne jamais convertir en matière « or jaune » sans preuve.', TRUE),

  ('non-ironing', 'sans repassage',
   'Vêtement — traitement/entretien tel qu''affirmé par la source.', TRUE),

  ('oxford shirt', 'chemise Oxford',
   'Vêtement — type de chemise, Oxford conservé comme appellation textile.', TRUE),

  ('nightdress', 'chemise de nuit',
   'Vêtement de nuit.', TRUE),

  ('fleece', 'polaire',
   'Textile/vêtement — selon usage matière ou vêtement.', TRUE),

  ('beanie', 'bonnet',
   'Accessoire vêtement — vocabulaire client français.', TRUE),

  ('faux leather', 'similicuir',
   'Vêtement/accessoire — ne jamais simplifier en « cuir ».', TRUE),

  ('rayon', 'rayonne',
   'Textile uniquement — terme anglais matière ; ne pas appliquer au mot français « rayon » hors contexte textile.', TRUE)

ON CONFLICT (term_source)
DO UPDATE SET
  term_fr = EXCLUDED.term_fr,
  note = EXCLUDED.note,
  is_active = TRUE,
  updated_at = NOW();
