import sys; sys.path.insert(0, sys.argv[1] if len(sys.argv) > 1 else __import__("os").path.dirname(__file__))
import sim
def show(tag, n):
    for r in sim.run(n):
        print(tag, n, r['model'][:2], 'cost', r['cost_per_order'], 'capital', r['capital_per_order'], 'late', r['late_share'], 'median', r['lead_median'])
for n in (100, 1000):
    show('1dep', n)
# deux départs par semaine : lundi + jeudi pour tous
DEPS = {'KM': (0, 3), 'CM': (1, 4), 'CG': (1, 4)}
def nd(m, t):
    d = int(t) + 1
    while d % 7 not in DEPS[m]:
        d += 1
    return d
sim.next_departure = nd
for n in (100, 1000):
    show('2dep', n)
