BEGIN;

UPDATE boutique_categories
SET section_emoji = '%',
    icon_svg = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="currentColor"/><circle cx="8.5" cy="8.5" r="1.5" fill="none" stroke="#fff" stroke-width="1.8"/><circle cx="15.5" cy="15.5" r="1.5" fill="none" stroke="#fff" stroke-width="1.8"/><path d="M16.5 7.5 7.5 16.5" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg>',
    image_url = '/boutique/categories/cat-soldes-badge-v2.svg',
    image_alt = 'Soldes et remises',
    updated_at = NOW()
WHERE key = 'Soldes';

COMMIT;
