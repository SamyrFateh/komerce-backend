'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const {
  classifyUrlSyntactically,
  detectVideoForms,
  normalizeMedia,
} = require('../../services/suppliers/media-normalizer');
const { FINDINGS } = require('../../services/suppliers/pipeline-constants');

const profile = {
  media: { gallery_source_field: 'images', thumbnail_fallback: true },
  policies: { missing_image: 'QUARANTINE', duplicate_relation: 'DEDUPE', asset_reuse: 'ALLOW' },
};

describe('media-normalizer', () => {
  test('classifie les URLs sans effectuer de requête réseau', () => {
    expect(classifyUrlSyntactically('https://cdn.example.com/a.jpg').syntacticallyValid).toBe(true);
    expect(classifyUrlSyntactically('ftp://example.com/a.jpg').syntacticallyValid).toBe(false);
    expect(classifyUrlSyntactically(null)).toEqual({ present: false });
  });

  test('détecte les trois formes vidéo sans décider la promotion', () => {
    const result = detectVideoForms({
      videos: [{ url: 'https://cdn.example.com/a.mp4' }],
      video: 'https://cdn.example.com/b.mp4',
      media: [{ type: 'video', url: 'https://cdn.example.com/c.mp4' }],
    });

    expect(result.hasVideo).toBe(true);
    expect(result.forms).toEqual([
      'form1_videos_array',
      'form2_video_string',
      'form3_media_array',
    ]);
    expect(result.videoItems).toHaveLength(3);
  });

  test('déduplique une relation média identique et recalcule display_order', () => {
    const result = normalizeMedia({
      images: ['https://cdn.example.com/a.jpg', 'https://cdn.example.com/a.jpg', 'https://cdn.example.com/b.jpg'],
    }, profile);

    expect(result.media).toEqual([
      { url: 'https://cdn.example.com/a.jpg', role: 'PRODUCT', display_order: 0 },
      { url: 'https://cdn.example.com/b.jpg', role: 'PRODUCT', display_order: 1 },
    ]);
    expect(result.findings.some(f => f.code === FINDINGS.MEDIA_RELATION_DEDUPLICATED)).toBe(true);
  });

  test('utilise thumbnail uniquement lorsque la galerie est vide', () => {
    const result = normalizeMedia({ images: [], thumbnail: 'https://cdn.example.com/thumb.jpg' }, profile);
    expect(result.roleAssignmentBasis).toBe('thumbnail_fallback');
    expect(result.media[0].url).toBe('https://cdn.example.com/thumb.jpg');
    expect(result.findings.some(f => f.code === FINDINGS.THUMBNAIL_FALLBACK_USED)).toBe(true);
  });
});
