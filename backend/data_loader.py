import os
import json
import csv

DATA_DIR = os.path.join(os.path.dirname(__file__), "data")

def load_json(filename):
    try:
        with open(os.path.join(DATA_DIR, filename), "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        print(f"Error loading {filename}: {e}")
        return []

def safe_float(val):
    try:
        return float(val)
    except (ValueError, TypeError):
        return 0.0

def safe_int(val):
    try:
        return int(float(val))
    except (ValueError, TypeError):
        return 0

def load_csv_players():
    players = []
    try:
        csv_path = os.path.join(DATA_DIR, "international-world-cup-players-2026-to-2026-stats.csv")
        with open(csv_path, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                rating = safe_float(row.get('average_rating_overall', 0))
                if rating <= 0:
                    continue
                
                name = row.get('full_name')
                if not name:
                    continue
                
                players.append({
                    "name": name,
                    "team": row.get('nationality', ''),
                    "position": row.get('position', ''),
                    "age": safe_int(row.get('age', 0)),
                    "rating": rating,
                    "goals": safe_int(row.get('goals_overall', 0)),
                    "assists": safe_int(row.get('assists_overall', 0)),
                    "minutes": safe_int(row.get('minutes_played_overall', 0)),
                    "xg": safe_float(row.get('xg_total_overall', 0)),
                    "goals_per90": safe_float(row.get('goals_per_90_overall', 0)),
                    "assists_per90": safe_float(row.get('assists_per_90_overall', 0)),
                    "pass_acc": safe_float(row.get('pass_completion_rate_overall', 0)),
                    "club": row.get('Current Club', '')
                })
        print(f"Loaded {len(players)} real WC 2026 players from CSV")
        return players
    except Exception as e:
        print(f"CSV load error: {e}")
        return []

SQUADS = load_json("data_squads.json")
FIXTURES = load_json("data_fixtures.json")
GROUPS = load_json("data_groups.json")
ANALYTICS = load_json("data_analytics.json")
PERFORMERS = load_json("data_performers.json")
CSV_PLAYERS = load_csv_players()

teamFixtures = {}
if isinstance(FIXTURES, list):
    for f in FIXTURES:
        for t in [f.get("home"), f.get("away")]:
            if t:
                if t not in teamFixtures:
                    teamFixtures[t] = []
                teamFixtures[t].append(f)
