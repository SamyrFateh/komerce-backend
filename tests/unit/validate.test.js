'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const Joi = require('joi');
const { validate, sanitize, sanitizeString, sanitizeDeep } = require('../../middleware/validate');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('middleware/validate — sanitizeString', () => {
  it('retourne la valeur telle quelle si ce n\'est pas une string', () => {
    expect(sanitizeString(42)).toBe(42);
    expect(sanitizeString(null)).toBeNull();
    expect(sanitizeString(undefined)).toBeUndefined();
    expect(sanitizeString({ a: 1 })).toEqual({ a: 1 });
  });

  it('trim les espaces en début/fin', () => {
    expect(sanitizeString('  hello  ')).toBe('hello');
  });

  it('supprime les balises HTML', () => {
    expect(sanitizeString('<script>alert(1)</script>hello')).toBe('alert(1)hello');
  });

  it('supprime les entités HTML', () => {
    expect(sanitizeString('caf&eacute; &amp; the')).toBe('caf the');
  });

  it('supprime les URI javascript:', () => {
    expect(sanitizeString('javascript:alert(1)')).toBe('alert(1)');
    expect(sanitizeString('JavaScript :alert(1)')).toBe('alert(1)');
  });

  it('supprime les handlers inline (onXxx=)', () => {
    expect(sanitizeString('onclick=alert(1)')).toBe('alert(1)');
    expect(sanitizeString('x onmouseover=evil() y')).toBe('x evil() y');
  });

  it('normalise les espaces multiples', () => {
    expect(sanitizeString('a    b\t\tc\n\nd')).toBe('a b c d');
  });

  it('tronque à la longueur maximale par défaut (10000)', () => {
    const long = 'a'.repeat(10005);
    expect(sanitizeString(long)).toHaveLength(10000);
  });

  it('respecte une maxLength personnalisée', () => {
    expect(sanitizeString('abcdefgh', 3)).toBe('abc');
  });
});

describe('middleware/validate — sanitizeDeep', () => {
  it('retourne null/undefined tels quels', () => {
    expect(sanitizeDeep(null)).toBeNull();
    expect(sanitizeDeep(undefined)).toBeUndefined();
  });

  it('sanitise une string simple', () => {
    expect(sanitizeDeep('  <b>hi</b>  ')).toBe('hi');
  });

  it('sanitise récursivement un tableau', () => {
    expect(sanitizeDeep(['  a  ', '<i>b</i>'])).toEqual(['a', 'b']);
  });

  it('sanitise récursivement un objet, y compris les clés', () => {
    const result = sanitizeDeep({ '  name  ': '  <b>Ali</b>  ', nested: { '<x>foo</x>': 'bar' } });
    expect(result).toEqual({ name: 'Ali', nested: { foo: 'bar' } });
  });

  it('retire les clés dangereuses __proto__, constructor, prototype (anti-pollution)', () => {
    const malicious = JSON.parse('{"__proto__": {"polluted": true}, "constructor": 1, "prototype": 2, "safe": "ok"}');
    const result = sanitizeDeep(malicious);
    expect(result).toEqual({ safe: 'ok' });
    expect(result.polluted).toBeUndefined();
    expect({}.polluted).toBeUndefined();
  });

  it('retourne les types primitifs non-string/objet tels quels (number, boolean)', () => {
    expect(sanitizeDeep(42)).toBe(42);
    expect(sanitizeDeep(true)).toBe(true);
  });
});

describe('middleware/validate — sanitize() middleware pur', () => {
  it('sanitise req.body et req.query puis appelle next()', () => {
    const req = { body: { name: '  <b>Ali</b>  ' }, query: { q: '  <i>x</i>  ' } };
    const next = jest.fn();

    sanitize()(req, {}, next);

    expect(req.body).toEqual({ name: 'Ali' });
    expect(req.query).toEqual({ q: 'x' });
    expect(next).toHaveBeenCalled();
  });

  it('ignore body/query absents ou non-objets', () => {
    const req = { body: null, query: undefined };
    const next = jest.fn();

    sanitize()(req, {}, next);

    expect(req.body).toBeNull();
    expect(req.query).toBeUndefined();
    expect(next).toHaveBeenCalled();
  });
});

describe('middleware/validate — validate() middleware', () => {
  const bodySchema = Joi.object({
    name: Joi.string().min(2).max(50).required(),
    email: Joi.string().email().required(),
  });

  it('valide un body correct, sanitise, remplace req.body, appelle next()', () => {
    const req = { body: { name: '  <b>Ali</b>  ', email: 'ali@test.com' } };
    const res = mockRes();
    const next = jest.fn();

    validate({ body: bodySchema })(req, res, next);

    expect(req.body.name).toBe('Ali');
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('retourne 400 avec détails structurés si le body est invalide', () => {
    const req = { body: { name: 'A' } }; // trop court + email manquant
    const res = mockRes();
    const next = jest.fn();

    validate({ body: bodySchema })(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    const payload = res.json.mock.calls[0][0];
    expect(payload.error).toBe('Données invalides');
    expect(payload.details.length).toBeGreaterThanOrEqual(2);
    expect(payload.details.every(d => d.source === 'body')).toBe(true);
    expect(next).not.toHaveBeenCalled();
  });

  it('valide params et query en plus du body, cumule les erreurs de plusieurs sources', () => {
    const schema = {
      params: Joi.object({ id: Joi.string().uuid().required() }),
      query: Joi.object({ page: Joi.number().integer().positive().required() }),
    };
    const req = { params: { id: 'not-a-uuid' }, query: { page: '-1' } };
    const res = mockRes();
    const next = jest.fn();

    validate(schema)(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    const payload = res.json.mock.calls[0][0];
    const sources = payload.details.map(d => d.source);
    expect(sources).toContain('params');
    expect(sources).toContain('query');
  });

  it('ignore les sources non déclarées dans le schéma', () => {
    const req = { body: { name: 'Ali', email: 'ali@test.com' }, query: { anything: 'goes' } };
    const res = mockRes();
    const next = jest.fn();

    validate({ body: bodySchema })(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.query).toEqual({ anything: 'goes' }); // non touché car pas dans le schéma
  });

  it('trim les valeurs de req.params sans sanitisation profonde', () => {
    const schema = { params: Joi.object({ id: Joi.string().required() }) };
    const req = { params: { id: '  abc123  ' } };
    const res = mockRes();
    const next = jest.fn();

    validate(schema)(req, res, next);

    expect(req.params.id).toBe('abc123');
    expect(next).toHaveBeenCalled();
  });

  it('option sanitize:false désactive la sanitisation (garde le HTML brut avant validation)', () => {
    const schema = { body: Joi.object({ name: Joi.string().required() }) };
    const req = { body: { name: '<b>Ali</b>' } };
    const res = mockRes();
    const next = jest.fn();

    validate(schema, { sanitize: false })(req, res, next);

    expect(req.body.name).toBe('<b>Ali</b>');
    expect(next).toHaveBeenCalled();
  });

  it('option stripUnknown:false autorise les champs inconnus (allowUnknown)', () => {
    const schema = { body: Joi.object({ name: Joi.string().required() }) };
    const req = { body: { name: 'Ali', extra: 'field' } };
    const res = mockRes();
    const next = jest.fn();

    validate(schema, { stripUnknown: false })(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.body.extra).toBe('field');
  });

  it('stripUnknown:true (défaut) retire les champs inconnus du résultat validé', () => {
    const schema = { body: Joi.object({ name: Joi.string().required() }) };
    const req = { body: { name: 'Ali', extra: 'field' } };
    const res = mockRes();
    const next = jest.fn();

    validate(schema)(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.body.extra).toBeUndefined();
  });

  it('n\'altère pas req.params si absent', () => {
    const schema = { body: Joi.object({ name: Joi.string().required() }) };
    const req = { body: { name: 'Ali' } };
    const res = mockRes();
    const next = jest.fn();

    validate(schema)(req, res, next);

    expect(req.params).toBeUndefined();
    expect(next).toHaveBeenCalled();
  });

  it('ignore les params non-string (ex: déjà casté en number par un middleware précédent)', () => {
    const req = { params: { id: 42, code: '  KOM-1  ' } };
    const res = mockRes();
    const next = jest.fn();

    validate({})(req, res, next);

    expect(req.params.id).toBe(42);
    expect(req.params.code).toBe('KOM-1');
    expect(next).toHaveBeenCalled();
  });

  it('messages d\'erreur personnalisés en français appliqués (any.required)', () => {
    const schema = { body: Joi.object({ name: Joi.string().required().label('name') }) };
    const req = { body: {} };
    const res = mockRes();
    const next = jest.fn();

    validate(schema)(req, res, next);

    const payload = res.json.mock.calls[0][0];
    expect(payload.details[0].message).toMatch(/obligatoire/);
  });
});
