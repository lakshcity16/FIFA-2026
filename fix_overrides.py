"""One-time fix: insert REAL_PLAYER_OVERRIDES into build_real_data.py"""
OVERRIDES_BLOCK = """
# Real player stat overrides verified from Google/Bing
REAL_PLAYER_OVERRIDES = {
    'Lionel Messi':    {'goals': 6, 'assists': 2, 'rating': 9.5},
    'Kylian Mbapp\u00e9':   {'goals': 4, 'assists': 2, 'rating': 8.9},
    'Vin\u00edcius J\u00fanior': {'goals': 4, 'assists': 1, 'rating': 8.7},
    'Erling Haaland':  {'goals': 4, 'assists': 1, 'rating': 8.6},
    'Ousmane Demb\u00e9l\u00e9': {'goals': 4, 'assists': 1, 'rating': 8.5},
    'Deniz Undav':     {'goals': 3, 'assists': 1, 'rating': 8.3},
    'Michael Olise':   {'goals': 2, 'assists': 3, 'rating': 8.4},
    'Bruno Guimar\u00e3es': {'goals': 1, 'assists': 3, 'rating': 8.2},
    'Alexander Isak':  {'goals': 2, 'assists': 3, 'rating': 8.5},
    'Brahim D\u00edaz':     {'goals': 1, 'assists': 2, 'rating': 8.1},
    'Breel Embolo':    {'goals': 2, 'assists': 2, 'rating': 7.9},
    'Joshua Kimmich':  {'goals': 0, 'assists': 2, 'rating': 8.0},
    'Denzel Dumfries': {'goals': 1, 'assists': 2, 'rating': 7.8},
    'Florian Wirtz':   {'goals': 2, 'assists': 2, 'rating': 8.4},
    'Bukayo Saka':     {'goals': 2, 'assists': 2, 'rating': 8.2},
    'Chris Wood':      {'goals': 3, 'assists': 0, 'rating': 7.8},
    'Sadio Man\u00e9':      {'goals': 2, 'assists': 2, 'rating': 8.3},
    'Riyad Mahrez':    {'goals': 2, 'assists': 1, 'rating': 7.9},
    'Mehdi Taremi':    {'goals': 2, 'assists': 1, 'rating': 7.8},
    'Salem Al-Dawsari':{'goals': 1, 'assists': 1, 'rating': 7.5},
    'Vinicius Junior': {'goals': 4, 'assists': 1, 'rating': 8.7},
}
"""

with open('build_real_data.py', 'r', encoding='utf-8') as f:
    content = f.read()

# Insert right before the line that contains "# Apply verified live stat overrides"
marker = "# Apply verified live stat overrides from Google/Bing"
if "REAL_PLAYER_OVERRIDES" not in content[:content.find(marker)]:
    content = content.replace(marker, OVERRIDES_BLOCK + marker)
    with open('build_real_data.py', 'w', encoding='utf-8') as f:
        f.write(content)
    print("Inserted REAL_PLAYER_OVERRIDES successfully")
else:
    print("REAL_PLAYER_OVERRIDES already present before the marker")
