BEGIN;

UPDATE boutique_categories
SET icon_svg = '<svg viewBox="0 0 24 24"><circle cx="7.25" cy="7.25" r="2.25"/><circle cx="16.75" cy="16.75" r="2.25"/><path d="M18.5 5.5 5.5 18.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>',
    image_url = '/boutique/categories/cat-soldes-percent-v1.svg',
    image_alt = 'Remises et soldes',
    updated_at = NOW()
WHERE key = 'Soldes';

COMMIT;
