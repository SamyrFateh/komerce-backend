INSERT INTO boutique_categories
  (key, label, short_label, section_emoji, icon_svg, db_keys, filter_type, display_order, show_in_rail, show_in_sections)
VALUES
  ('all', 'Tout', 'Tout', '🔥', NULL, '{}', NULL, 0, TRUE, FALSE),
  ('Soldes', 'Soldes', 'Soldes', '🏷️', NULL, '{}', 'promo', 1, TRUE, TRUE),
  ('Mode & Beauté', 'Mode & Beauté', 'Mode', '👗', NULL, ARRAY['Mode', 'Beauté'], NULL, 2, TRUE, TRUE),
  ('Tech', 'Tech', 'Tech', '📱', NULL, ARRAY['Tech'], NULL, 3, TRUE, TRUE),
  ('Enfant', 'Enfant', 'Enfant', '🧒', NULL, ARRAY['Enfant'], NULL, 4, TRUE, TRUE),
  ('Maison', 'Maison', 'Maison', '🏠', NULL, ARRAY['Maison'], NULL, 5, TRUE, TRUE),
  ('Sport', 'Sport', 'Sport', '⚽', NULL, ARRAY['Sport'], NULL, 6, TRUE, TRUE),
  ('Sur-mesure', 'Sur-mesure', 'Pour vous...', '✨', NULL, ARRAY['Sur-mesure'], NULL, 7, TRUE, TRUE)
ON CONFLICT (key) DO NOTHING;

INSERT INTO boutique_subcategories
  (category_key, key, label, short_label, icon, display_order)
VALUES
  ('Mode & Beauté', 'Femme', 'Femme', 'Femme', '👗', 1),
  ('Mode & Beauté', 'Homme', 'Homme', 'Homme', '👔', 2),
  ('Mode & Beauté', 'Hijab', 'Hijab', 'Hijab', '🧕', 3),
  ('Mode & Beauté', 'Boubou', 'Boubou', 'Boubou', '👘', 4),
  ('Mode & Beauté', 'Shoes', 'Shoes', 'Shoes', '👟', 5),
  ('Mode & Beauté', 'Parfums', 'Parfum', 'Parfum', '🌸', 6),
  ('Mode & Beauté', 'Soins', 'Soin', 'Soin', '🧴', 7),
  ('Mode & Beauté', 'Cheveux', 'Cheveux', 'Cheveux', '💇', 8),
  ('Mode & Beauté', 'Maquillage', 'Maquil.', 'Maquil.', '💄', 9),
  ('Mode & Beauté', 'Ongles', 'Ongles', 'Ongles', '💅', 10),

  ('Tech', 'Phones', 'Tél.', 'Tél.', '📱', 1),
  ('Tech', 'Ordi', 'Ordi', 'Ordi', '💻', 2),
  ('Tech', 'Audio', 'Audio', 'Audio', '🎧', 3),
  ('Tech', 'Montres', 'Montres', 'Montres', '⌚', 4),
  ('Tech', 'Gaming', 'Gaming', 'Gaming', '🎮', 5),

  ('Enfant', 'Bébé', 'Bébé', 'Bébé', '🍼', 1),
  ('Enfant', 'Garçon', 'Garçon', 'Garçon', '👦', 2),
  ('Enfant', 'Fille', 'Fille', 'Fille', '👧', 3),
  ('Enfant', 'Jouets', 'Jouets', 'Jouets', '🧸', 4),
  ('Enfant', 'École', 'École', 'École', '📚', 5),

  ('Maison', 'Cuisine', 'Cuisine', 'Cuisine', '🍳', 1),
  ('Maison', 'Salon', 'Salon', 'Salon', '🛋', 2),
  ('Maison', 'Chambre', 'Chambre', 'Chambre', '🛏', 3),
  ('Maison', 'Déco', 'Déco', 'Déco', '🖼', 4),
  ('Maison', 'Rangement', 'Rangem.', 'Rangem.', '📦', 5),

  ('Sport', 'Foot', 'Foot', 'Foot', '⚽', 1),
  ('Sport', 'Fitness', 'Fitness', 'Fitness', '💪', 2),
  ('Sport', 'Natation', 'Natation', 'Natation', '🏊', 3),
  ('Sport', 'Yoga', 'Yoga', 'Yoga', '🧘', 4),
  ('Sport', 'Outdoor', 'Outdoor', 'Outdoor', '🏕', 5),

  ('Sur-mesure', 'Couture', 'Couture', 'Couture', '🧵', 1),
  ('Sur-mesure', 'Design', 'Design', 'Design', '✏️', 2),
  ('Sur-mesure', 'Mesure', 'Mesure', 'Mesure', '📏', 3),
  ('Sur-mesure', 'Broderie', 'Broderie', 'Broderie', '🪡', 4),
  ('Sur-mesure', 'Premium', 'Premium', 'Premium', '⭐', 5)
ON CONFLICT (category_key, key) DO NOTHING;