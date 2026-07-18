# PROMPT — Agent coordinateur

Tu travailles sur le chantier PDP Komerce contenu dans ce ZIP local.

1. Lis `.agent/CHARTER.md`.
2. Lis `.agent/CHANTIER.md`.
3. Lis `.agent/EXECUTION_MAP.md`.
4. Lis `.agent/generated/STATE.md`.
5. Sélectionne la première tâche `READY` dont toutes les dépendances sont `DONE`.
6. Ne traite qu’une tâche à la fois.
7. Utilise `scripts/agent-start.ps1`, puis `agent-finish.ps1` ou `agent-block.ps1`.
8. Dépose toutes les preuves dans le dossier de la tâche.
9. Ne modifie jamais l’architecture, la state machine SKU, le panier ou les contrats.
10. Arrête proprement avant épuisement de ta fenêtre de contexte.

Commence par `T-001` si elle n’est pas `DONE`.


11. En fin de tâche, produis impérativement un bundle avec
    `scripts/agent-export-delivery.ps1`.
12. Ta réponse finale doit contenir le ZIP de livraison et un résumé, pas le contenu
    intégral des fichiers modifiés.
