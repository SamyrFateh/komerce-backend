# CHARTER â€” Constitution permanente des agents

Version : 1.0
Statut : immuable pendant un chantier, sauf dÃ©cision formelle enregistrÃ©e dans `decisions/`.

## 1. Source de vÃ©ritÃ©

Le code, les tÃ¢ches, les Ã©tats, les dÃ©cisions et les preuves prÃ©sents dans le paquet
de chantier sont la source de vÃ©ritÃ©.

Une conversation dâ€™agent ne constitue jamais une source de vÃ©ritÃ© durable.

## 2. Lecture obligatoire

Avant toute modification, lâ€™agent lit dans cet ordre :

1. `.agent/CHARTER.md`
2. `.agent/CHANTIER.md`
3. `.agent/MANIFEST.json`
4. `.agent/tasks/<TASK_ID>.md`
5. `.agent/state/<TASK_ID>.json`
6. les dÃ©cisions ADR rÃ©fÃ©rencÃ©es par la tÃ¢che

## 3. Attribution

Lâ€™agent doit rÃ©clamer une tÃ¢che avec `agent-start.ps1`.

Il est interdit de travailler sur :

- une tÃ¢che non `READY` ;
- une tÃ¢che dÃ©jÃ  rÃ©clamÃ©e par un autre agent ;
- une tÃ¢che dont les dÃ©pendances ne sont pas `DONE` ;
- un pÃ©rimÃ¨tre non dÃ©fini.

## 4. PÃ©rimÃ¨tre

Chaque tÃ¢che dÃ©clare :

- les fichiers autorisÃ©s ;
- les fichiers explicitement interdits ;
- les composants ou features concernÃ©s ;
- les critÃ¨res dâ€™acceptation ;
- les gates obligatoires.

Toute extension de pÃ©rimÃ¨tre impose :

- soit la crÃ©ation dâ€™une sous-tÃ¢che ;
- soit le passage de la tÃ¢che Ã  `BLOCKED` ;
- soit une dÃ©cision ADR validÃ©e.

## 5. Feature-First

Toute tÃ¢che doit Ãªtre rattachÃ©e Ã  au moins un `feature_id`.

Une modification sans rattachement fonctionnel, architectural ou de gouvernance
explicite est interdite.

## 6. AtomicitÃ©

Une tÃ¢che doit produire un rÃ©sultat vÃ©rifiable et rÃ©versible.

Un commit ou un paquet de changements ne doit pas mÃ©langer plusieurs objectifs
indÃ©pendants.

## 7. Tests et gates

Lâ€™agent exÃ©cute les gates dÃ©clarÃ©es dans la tÃ¢che.

Un gate non exÃ©cutÃ© doit Ãªtre marquÃ© `NOT_RUN` avec une justification prÃ©cise.
Un gate en Ã©chec interdit le passage direct Ã  `DONE`.

## 8. Preuves

Les preuves sont dÃ©posÃ©es dans `.agent/evidence/<TASK_ID>/`.

Exemples :

- captures avant/aprÃ¨s ;
- logs ;
- rÃ©sultats de tests ;
- sortie de commandes ;
- rapport de contrÃ´le ;
- fichier patch.

## 9. Handoff

Avant de sâ€™arrÃªter, lâ€™agent produit un handoff dans
`.agent/handoffs/<TASK_ID>.md`.

Le handoff indique au minimum :

- ce qui a Ã©tÃ© fait ;
- ce qui nâ€™a pas Ã©tÃ© fait ;
- les fichiers modifiÃ©s ;
- les tests exÃ©cutÃ©s ;
- les hypothÃ¨ses ;
- les risques ;
- la prochaine action exacte ;
- lâ€™Ã©tat Git ou lâ€™inventaire de fichiers.

## 10. Fin de fenÃªtre

Lâ€™agent cesse de commencer de nouvelles tÃ¢ches lorsquâ€™il estime avoir consommÃ©
environ 80 % de sa fenÃªtre de travail.

Il utilise le temps restant pour :

- stabiliser lâ€™Ã©tat ;
- enregistrer les preuves ;
- mettre Ã  jour le handoff ;
- terminer proprement ou bloquer la tÃ¢che.

## 11. Revue

Lâ€™agent exÃ©cutant ne peut pas dÃ©clarer seul une tÃ¢che sensible `DONE`.

La tÃ¢che passe dâ€™abord Ã  `REVIEW`, puis un reviewer lâ€™approuve ou la rejette.

## 12. Travail parallÃ¨le

Deux tÃ¢ches actives ne doivent pas modifier les mÃªmes fichiers, sauf coordination
explicite par dÃ©pendance ou dÃ©cision ADR.

Chaque agent parallÃ¨le travaille depuis le mÃªme `base_package_id`.

## 13. Interdictions

Il est interdit de :

- supprimer ou contourner la gouvernance ;
- rÃ©Ã©crire lâ€™historique du chantier sans dÃ©cision ;
- masquer un test en Ã©chec ;
- dÃ©clarer une tÃ¢che terminÃ©e sans preuves ;
- modifier un fichier hors pÃ©rimÃ¨tre sans le signaler ;
- transfÃ©rer la responsabilitÃ© au prochain agent sans handoff exploitable ;
- laisser une tÃ¢che indÃ©finiment en `IN_PROGRESS`.

## 14. PrioritÃ©

En cas de conflit :

1. sÃ©curitÃ© et intÃ©gritÃ© des donnÃ©es ;
2. dÃ©cisions ADR validÃ©es ;
3. CHARTER ;
4. CHANTIER ;
5. tÃ¢che ;
6. prÃ©fÃ©rence locale de lâ€™agent.


## 15. Livraison structurÃ©e

Lâ€™agent ne livre jamais des fichiers Ã  copier-coller depuis sa rÃ©ponse.

AprÃ¨s avoir terminÃ© ou bloquÃ© sa tÃ¢che, il produit un bundle avec
`agent-export-delivery.ps1` et remet ce ZIP Ã  lâ€™utilisateur.

Le repo principal applique le bundle uniquement avec
`agent-import-delivery.ps1`. Lâ€™extraction manuelle par-dessus le repo est interdite.

## 16. Validation locale

Les gates exÃ©cutÃ©s dans la copie de lâ€™agent constituent une preuve, mais pas
lâ€™autorisation de commit.

AprÃ¨s import, le repo principal exÃ©cute `agent-validate-delivery.ps1`.
Une tÃ¢che importÃ©e ne peut Ãªtre approuvÃ©e que si la validation locale est `PASS`.

## 17. TraÃ§abilitÃ© de livraison

Le ZIP brut est archivÃ© localement. Le record lÃ©ger, le patch, le handoff, les
preuves et lâ€™Ã©tat sont versionnÃ©s avec le code.

Aucun fichier livrÃ© ne doit exister uniquement dans une conversation ou un dossier
temporaire non rÃ©fÃ©rencÃ©.
