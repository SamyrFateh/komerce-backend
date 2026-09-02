# Komerce Boutique — V2.8 Mobile Home Composition

## Decision

Preserve the Temu horizontal category grammar while making `Tout` a proximity-first discovery home.

Mobile order:

1. compact brand hero;
2. horizontal Temu category rail;
3. visible search launcher in the `Tout` vertical flow;
4. `Près de vous` as the first merchant surface, horizontal and compact;
5. regular Komerce catalog grid.

The header keeps only a lightweight global search trigger. The real search engine is not duplicated: the in-flow launcher focuses the canonical `#k-search-input`.

## UX doctrine

- Hero = brand signature.
- Categories = navigation context.
- Search = utility, not permanent chrome.
- `Près de vous` = closest / most available discovery surface.
- Product cards = scan.
- Modal = detail and validation.

## Ranking direction

V2.8 changes composition only. The current backend still preserves explicit editorial `DISCOVERY_RAIL_CANDIDATES` ordering.

A later ranking lot may enrich Discovery with real geographic and availability signals so the backend can order by:

`proximity -> availability -> editorial relevance`.

No fake distance ranking is introduced in V2.8.

## Non-goals

- no replacement of the Temu pager;
- no additional product-card density change;
- no new search engine;
- no client-side fake proximity score;
- no desktop redesign.
