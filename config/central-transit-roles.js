'use strict';

// Source canonique des acteurs de transit CENTRAUX : ils servent tout marche ACTIF sans membership marche.
// Partagee par le workspace Expeditions & Douane (routes) et le contexte dashboard (portail). Lecture/transit
// uniquement : douane, couts, cloture et le reste du back-office restent hors de leur portee.
const CENTRAL_TRANSIT_ROLES = Object.freeze(['agent_hub', 'agent_transitaire']);

module.exports = { CENTRAL_TRANSIT_ROLES };
