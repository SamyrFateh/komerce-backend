'use strict';

const { parseDumpCounts, syncSummaryText } = require('../../scripts/schema-sync-summary');

describe('schema-sync-summary', () => {
  test('derive les compteurs depuis les DDL du dump pg_dump', () => {
    const dump = `
CREATE TYPE public.user_role AS ENUM (
  'admin'
);
CREATE TABLE public.users (
  id uuid NOT NULL
);
CREATE TABLE public.orders (
  id uuid NOT NULL,
  user_id uuid
);
CREATE VIEW public.v_orders AS
 SELECT id FROM public.orders;
CREATE UNIQUE INDEX users_pkey ON public.users USING btree (id);
CREATE INDEX idx_orders_user ON public.orders USING btree (user_id);
ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_user_fk FOREIGN KEY (user_id) REFERENCES public.users(id);
CREATE FUNCTION public.touch_updated_at() RETURNS trigger
    LANGUAGE plpgsql;
CREATE TRIGGER trg_orders_updated BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
`;

    expect(parseDumpCounts(dump)).toEqual({
      tables: 2,
      views: 1,
      enums: 1,
      indexes: 2,
      foreignKeys: 1,
      functions: 1,
      triggers: 1,
    });
  });

  test('met a jour uniquement les compteurs de la vue d ensemble', () => {
    const schema = `| Objet | Compte | Note |
|---|---|---|
| Tables | 1 | live |
| Vues | 2 | live |
| ENUMs | 3 | live |
| Index | 4 | live |
| Foreign keys | 5 | live |
| Fonctions | 6 | live |
| Triggers | 7 | live |
`;
    const counts = {
      tables: 121,
      views: 17,
      enums: 16,
      indexes: 270,
      foreignKeys: 154,
      functions: 15,
      triggers: 32,
    };

    const result = syncSummaryText(schema, counts);
    expect(result.changes).toHaveLength(7);
    expect(result.text).toContain('| Tables | 121 | live |');
    expect(result.text).toContain('| ENUMs | 16 | live |');
    expect(result.text).toContain('| Foreign keys | 154 | live |');
    expect(result.text).toContain('| Triggers | 32 | live |');
  });

  test('echoue si une ligne canonique de synthese disparait', () => {
    expect(() => syncSummaryText('| Tables | 1 | live |\n', {
      tables: 1, views: 0, enums: 0, indexes: 0, foreignKeys: 0, functions: 0, triggers: 0,
    })).toThrow(/Vues/);
  });
});
