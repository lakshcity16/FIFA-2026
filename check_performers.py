import json
d = json.load(open('public/data_performers.json', encoding='utf-8'))
print('=== TOP GOALS ===')
for p in d['goals'][:5]:
    print(f"  {p['player_name']} ({p['team']}) - {p['goals']} goals")
print('=== TOP ASSISTS ===')
for p in d['assists'][:5]:
    print(f"  {p['player_name']} ({p['team']}) - {p['assists']} assists")
print('=== TOP RATING ===')
for p in d['rating'][:5]:
    print(f"  {p['player_name']} ({p['team']}) - {p['rating']} rating")
