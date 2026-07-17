#!/usr/bin/env python3
"""Align extracted picker hierarchy against MC flat-book section heads.

Inputs (same dir): merged.jsonl, overrides.json
             repo: mc-assemblies/mc-assemblies.json
Outputs (same dir): heads-assigned.csv, unmatched-heads.csv,
                    unmatched-candidates.csv, stats.txt
"""
import json, csv, re, collections, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = '/Users/robertdouglas/_SYNC/github/Click-Construction/takeofftooling.github.io'

def norm(s):
    return re.sub(r'\s+', ' ', (s or '').strip().lower())

def norm2(s):
    """Looser normalization: drop inch-quotes, periods; hyphens/slashes spacing unified."""
    s = (s or '').lower()
    s = s.replace('"', '').replace('.', '')
    s = re.sub(r'\s*-\s*', '-', s)
    s = re.sub(r'\s+', ' ', s).strip()
    return s

def imgnum(name):
    return int(re.search(r'_(\d+)\.png$', name).group(1))

# ---------- load extraction records ----------
recs = {}
for line in open(os.path.join(HERE, 'merged.jsonl')):
    line = line.strip()
    if not line:
        continue
    r = json.loads(line)
    recs[r['image']] = r
overrides = json.load(open(os.path.join(HERE, 'overrides.json')))
recs.update(overrides)

# ---------- canonicalize into candidates ----------
# candidate: (imgnum, order, rawname, l1, l2, l3)
candidates = []
for img, r in recs.items():
    if 'error' in r:
        continue
    l1, l2, l3 = r.get('level1', ''), r.get('level2', ''), r.get('level3', '')
    col4 = r.get('col4') or []
    n = imgnum(img)
    if col4:
        for i, name in enumerate(col4):
            candidates.append((n, i, name, l1, l2, l3))
    elif l3:
        # 2-level node: the lowercase item was recorded as level3
        candidates.append((n, 0, l3, l1, l2, ''))
    elif l2:
        # 1-level node: the item was recorded as level2
        candidates.append((n, 0, l2, l1, '', ''))

candidates.sort(key=lambda c: (c[0], c[1]))

# name -> list of candidates (in image order)
byname = collections.defaultdict(list)
for c in candidates:
    byname[norm(c[2])].append(c)

# also index by 27-char truncated norm (flat book truncates raw at 27)
bytrunc = collections.defaultdict(list)
for c in candidates:
    t = norm(c[2][:27])
    bytrunc[t].append(c)

# loose index (norm2, full and truncated)
byloose = collections.defaultdict(list)
for c in candidates:
    byloose[norm2(c[2])].append(c)
    byloose[norm2(c[2][:27])].append(c)

def cand_paths(cands):
    return sorted(set((c[3], c[4], c[5]) for c in cands))

# ---------- load flat book ----------
data = json.load(open(os.path.join(REPO, 'mc-assemblies/mc-assemblies.json')))
assemblies = data['assemblies']

def is_head(a):
    return (not a['items'] and not a.get('material') and not a.get('laborHours')
            and not a.get('unitPrice1') and not a.get('unitPrice2'))

heads = [a for a in assemblies if is_head(a)]

# ---------- pass 1: unambiguous name match ----------
assigned = {}   # assmNum -> (l1,l2,l3, matchType)
ambiguous = collections.defaultdict(list)  # normname -> [head,...]
unmatched = []

for h in heads:
    hn = norm(h['assmName'])
    cands = byname.get(hn) or bytrunc.get(hn)
    loose = False
    if not cands:
        cands = byloose.get(norm2(h['assmName']))
        loose = True
    if not cands:
        unmatched.append(h)
        continue
    paths = cand_paths(cands)
    if len(paths) == 1:
        assigned[h['assmNum']] = (*paths[0], 'loose' if loose else 'unique')
    else:
        ambiguous[hn if not loose else norm2(h['assmName'])].append(h)

# ---------- pass 2: collect ambiguous names for distance scoring ----------
kth_fail = []
for hn, hs in ambiguous.items():
    cands = byname.get(hn) or bytrunc.get(hn) or byloose.get(hn)
    # distinct paths in image order (first appearance)
    paths_in_order = []
    for c in cands:
        p = (c[3], c[4], c[5])
        if p not in paths_in_order:
            paths_in_order.append(p)
    kth_fail.append((hn, hs, paths_in_order))

# ---------- pass 3: distance-scored path choice for remaining ----------
# For heads whose name matched candidates in multiple picker locations:
# choose the path whose (level1, level2) region is nearest in flat order,
# measured by distance to another head already assigned to that region.
head_index = {h['assmNum']: i for i, h in enumerate(heads)}

def best_path_by_distance(h, allowed):
    i = head_index[h['assmNum']]
    best, best_dist = None, None
    for p in allowed:
        # nearest assigned head sharing (level1, level2); fallback level1 only
        dist_l2 = dist_l1 = None
        for delta in range(1, len(heads)):
            done = True
            for j in (i - delta, i + delta):
                if 0 <= j < len(heads):
                    done = False
                    ap = assigned.get(heads[j]['assmNum'])
                    if ap:
                        if dist_l2 is None and (ap[0], ap[1]) == (p[0], p[1]):
                            dist_l2 = delta
                        if dist_l1 is None and ap[0] == p[0]:
                            dist_l1 = delta
            if dist_l2 is not None or done or delta > 400:
                break
        score = dist_l2 if dist_l2 is not None else (10000 + (dist_l1 or 99999))
        if best_dist is None or score < best_dist:
            best, best_dist = p, score
        elif score == best_dist:
            best = best  # keep first on tie
    return best

for hn, hs, paths in kth_fail:
    allowed = list(dict.fromkeys(paths))
    for h in hs:
        if h['assmNum'] in assigned:
            continue
        p = best_path_by_distance(h, allowed)
        if p:
            assigned[h['assmNum']] = (*p, 'distance')
        else:
            unmatched.append(h)

# ---------- candidates that never matched any head ----------
head_norms = set()
head_norms2 = set()
for h in heads:
    head_norms.add(norm(h['assmName']))
    head_norms2.add(norm2(h['assmName']))
cand_unmatched = []
seen = set()
for c in candidates:
    cn = norm(c[2])
    key = (cn, c[3], c[4], c[5])
    if key in seen:
        continue
    seen.add(key)
    tn = norm(c[2][:27])
    if (cn not in head_norms and tn not in head_norms
            and norm2(c[2]) not in head_norms2 and norm2(c[2][:27]) not in head_norms2):
        cand_unmatched.append(c)

# ---------- write outputs ----------
with open(os.path.join(HERE, 'heads-assigned.csv'), 'w', newline='') as f:
    w = csv.writer(f)
    w.writerow(['assmNum', 'assmName', 'level1', 'level2', 'level3', 'matchType'])
    for h in heads:
        p = assigned.get(h['assmNum'])
        if p:
            w.writerow([h['assmNum'], h['assmName'], p[0], p[1], p[2], p[3]])

with open(os.path.join(HERE, 'unmatched-heads.csv'), 'w', newline='') as f:
    w = csv.writer(f)
    w.writerow(['assmNum', 'assmName'])
    for h in unmatched:
        w.writerow([h['assmNum'], h['assmName']])

with open(os.path.join(HERE, 'unmatched-candidates.csv'), 'w', newline='') as f:
    w = csv.writer(f)
    w.writerow(['image', 'name', 'level1', 'level2', 'level3'])
    for c in cand_unmatched:
        w.writerow([f'Screenshot_{c[0]}.png', c[2], c[3], c[4], c[5]])

types = collections.Counter(v[3] for v in assigned.values())
stats = [
    f'heads total:          {len(heads)}',
    f'heads assigned:       {len(assigned)}  {dict(types)}',
    f'heads unmatched:      {len(unmatched)}',
    f'candidates (uniq):    {len(seen)}',
    f'candidates unmatched: {len(cand_unmatched)}',
]
open(os.path.join(HERE, 'stats.txt'), 'w').write('\n'.join(stats) + '\n')
print('\n'.join(stats))
