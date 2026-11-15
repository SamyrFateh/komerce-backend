Armement du workflow hub-h1h9-closure-sonnet (G2). Sans l'un de ces fichiers, un push ne declenche AUCUNE ecriture staging.
  RUN_T9_CREATE : 1re ligne = RUN8 neuf (8 hex majuscules). Cree l'objet T9 (colis arrive sans manifeste), inerte.
  RUN_T9_CHECK  : 1re ligne = RUN8 du T9 ; 2e ligne (optionnelle) = created_at attendu ISO. Controle lecture seule apres 48 h.
  RUN_ARMED     : lance C2/T3/T4 sur une fixture RUN8 neuve (apres fusion A1/A2 uniquement ; decision Opus).
