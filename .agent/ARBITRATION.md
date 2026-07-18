# Doctrine d’arbitrage

Le mode silencieux s’interrompt uniquement lorsqu’une décision dépasse réellement le mandat : contradiction de spécifications, changement produit/UX, API, données, architecture, sécurité, périmètre ou action irréversible.

Avant de poser une question, l’agent doit :

1. terminer le petit lot courant ;
2. écrire les preuves et le worklog ;
3. committer et pousser ;
4. passer la tâche à `AWAITING_DECISION` ;
5. poser une seule question avec deux ou trois options et une recommandation.

Un détail d’implémentation réversible, un nom de variable, un outil absent avec fallback ou une correction évidente ne justifient pas d’arbitrage.
