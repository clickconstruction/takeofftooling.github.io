#!/usr/bin/env python3
"""Propagate hierarchy from assigned section heads to every assembly.

Reads heads-assigned.csv + mc-assemblies.json; writes:
  - source-data/mc-assemblies.json (updated in place: level1-3, section, subsection)
  - source-data/mc-hierarchy.csv   (full per-assembly mapping, keyed by assmNum)
Prints coverage stats.
"""
import json, csv, os, collections

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))

assigned = {}
for row in csv.DictReader(open(os.path.join(HERE, 'heads-assigned.csv'))):
    assigned[int(row['assmNum'])] = (row['level1'], row['level2'], row['level3'], row['matchType'])

data = json.load(open(os.path.join(REPO, 'source-data/mc-assemblies.json')))
assemblies = data['assemblies']

def is_head(a):
    return (not a['items'] and not a.get('material') and not a.get('laborHours')
            and not a.get('unitPrice1') and not a.get('unitPrice2'))

cur = ('', '', '')      # level1, level2, level3
cur_section = ''        # nearest assigned head name
cur_sub = ''            # nearest unassigned head name inside the section
stats = collections.Counter()

for a in assemblies:
    if is_head(a):
        info = assigned.get(a['assmNum'])
        if info:
            cur = (info[0], info[1], info[2])
            cur_section = a['assmName']
            cur_sub = ''
            stats['head_assigned'] += 1
        else:
            cur_sub = a['assmName']
            stats['head_nested'] += 1
        a['level1'], a['level2'], a['level3'] = cur
        a['section'] = cur_section
        a['subsection'] = cur_sub if not info else ''
    else:
        a['level1'], a['level2'], a['level3'] = cur
        a['section'] = cur_section
        a['subsection'] = cur_sub
        stats['assembly_with_path' if cur[0] else 'assembly_no_path'] += 1

with open(os.path.join(REPO, 'source-data/mc-assemblies.json'), 'w') as f:
    json.dump(data, f, indent=2)

with open(os.path.join(REPO, 'source-data/mc-hierarchy.csv'), 'w', newline='') as f:
    w = csv.writer(f)
    w.writerow(['assmNum', 'assmName', 'isHead', 'level1', 'level2', 'level3', 'section', 'subsection', 'material', 'laborHours'])
    for a in assemblies:
        w.writerow([a['assmNum'], a['assmName'], 1 if is_head(a) else 0,
                    a['level1'], a['level2'], a['level3'], a['section'], a['subsection'],
                    a.get('material', 0), a.get('laborHours', 0)])

print(dict(stats))
total_priced = stats['assembly_with_path'] + stats['assembly_no_path']
print(f"priced assemblies: {total_priced}, with path: {stats['assembly_with_path']} "
      f"({100*stats['assembly_with_path']/total_priced:.1f}%)")

# distribution by level1
l1 = collections.Counter(a['level1'] for a in assemblies if not is_head(a))
for k, v in l1.most_common():
    print(f'{v:6d}  {k!r}')
