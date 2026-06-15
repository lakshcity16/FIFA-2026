import json, pandas as pd, math, os

df = pd.read_csv('fifa_world_cup_2026_player_performance.csv')
with open('public/team_map.json') as f:
    TEAM_MAP = json.load(f)

CURRENT_DATE = '2026-06-15'
os.makedirs('public', exist_ok=True)

print("Building group standings...")
groups_dict = {}
for tm, meta in TEAM_MAP.items():
    g = meta['group']
    if g not in groups_dict:
        groups_dict[g] = {}
    groups_dict[g][tm] = {
        'team': tm, 'group': g, 'mp':0,'w':0,'d':0,'l':0,'gf':0,'ga':0,'gd':0,'pts':0,
        'flag': 'https://flagcdn.com/w40/'+meta['iso2']+'.png',
        'fifa_code': meta['fifa_code']
    }

# Read fixtures
with open('public/data_fixtures.json') as f:
    fixtures = json.load(f)

for fix in fixtures:
    if not fix['is_played'] or fix['stage'] != 'Group Stage':
        continue
    home, away = fix['home'], fix['away']
    hs, as_ = fix['home_score'], fix['away_score']
    for tm, tf, of in [(home, hs, as_), (away, as_, hs)]:
        g = TEAM_MAP.get(tm, {}).get('group')
        if not g or g not in groups_dict or tm not in groups_dict[g]:
            continue
        row = groups_dict[g][tm]
        row['mp'] += 1
        row['gf'] += tf
        row['ga'] += of
        row['gd'] = row['gf'] - row['ga']
        if tf > of:
            row['w'] += 1
            row['pts'] += 3
        elif tf == of:
            row['d'] += 1
            row['pts'] += 1
        else:
            row['l'] += 1

final_groups = {}
for g in sorted(groups_dict.keys()):
    teams_list = list(groups_dict[g].values())
    teams_list.sort(key=lambda x: (-x['pts'], -x['gd'], -x['gf']))
    final_groups[g] = teams_list

with open('public/data_groups.json', 'w') as f:
    json.dump(final_groups, f)
print("Groups saved:", list(final_groups.keys()))
for g, teams in final_groups.items():
    info = [(t['team'], t['pts']) for t in teams]
    print(f"  Group {g}: {info}")

print("\nBuilding team analytics...")
analytics = {}
for team in TEAM_MAP.keys():
    tm_df = df[df['team']==team]
    if len(tm_df) == 0:
        continue
    meta = TEAM_MAP[team]
    
    off_score = min(100, round(float(tm_df['offensive_contribution'].mean()), 1))
    def_score = min(100, round(float(tm_df['defensive_contribution'].mean()), 1))
    pass_score = min(100, round(float(tm_df['pass_accuracy'].mean())*100, 1))
    poss_score = min(100, round(float(tm_df['possession_impact'].mean()), 1))
    crea_score = min(100, round(float(tm_df['creativity_score'].mean()), 1))
    overall = round(float(tm_df['player_rating'].mean()), 2)
    
    # Per-match stats
    match_df = tm_df.groupby('match_id')[['goals','shots','expected_goals_xg']].sum()
    match_avg = match_df.mean()
    
    # Position breakdown
    pos_counts = tm_df[['player_name','position']].drop_duplicates()['position'].value_counts().to_dict()
    
    analytics[team] = {
        'team': team,
        'group': meta['group'],
        'iso2': meta['iso2'],
        'fifa_code': meta['fifa_code'],
        'flag': 'https://flagcdn.com/w40/'+meta['iso2']+'.png',
        'overall_rating': overall,
        'offense': off_score,
        'defense': def_score,
        'passing': pass_score,
        'possession': poss_score,
        'creativity': crea_score,
        'avg_goals': round(float(match_avg.get('goals', 0)), 2),
        'avg_shots': round(float(match_avg.get('shots', 0)), 2),
        'avg_xg': round(float(match_avg.get('expected_goals_xg', 0)), 2),
        'pos_breakdown': pos_counts
    }

with open('public/data_analytics.json', 'w') as f:
    json.dump(analytics, f)
print("Analytics saved for", len(analytics), "teams")

print("\nBuilding top performers...")
player_agg = df.groupby(['player_name','team','position']).agg(
    goals=('goals','sum'),
    assists=('assists','sum'),
    rating=('player_rating','mean'),
    xg=('expected_goals_xg','sum'),
    minutes=('minutes_played','sum'),
    saves=('saves','sum'),
    clean_sheets=('clean_sheet','sum')
).reset_index()
player_agg['rating'] = player_agg['rating'].round(2)
player_agg['xg'] = player_agg['xg'].round(2)

top = {
    'goals': player_agg.nlargest(15, 'goals')[['player_name','team','position','goals']].to_dict('records'),
    'assists': player_agg.nlargest(15, 'assists')[['player_name','team','position','assists']].to_dict('records'),
    'rating': player_agg[player_agg['minutes']>=90].nlargest(15, 'rating')[['player_name','team','position','rating']].to_dict('records'),
    'xg': player_agg.nlargest(15, 'xg')[['player_name','team','position','xg']].to_dict('records'),
    'saves': player_agg[player_agg['position']=='Goalkeeper'].nlargest(10, 'saves')[['player_name','team','position','saves']].to_dict('records'),
}
with open('public/data_performers.json', 'w') as f:
    json.dump(top, f)
print("Performers saved")
print("\nAll data files built successfully!")
