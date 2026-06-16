import os
import json
import random
import datetime
import httpx
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv
from data_loader import SQUADS, FIXTURES, GROUPS, ANALYTICS, PERFORMERS, CSV_PLAYERS, teamFixtures

load_dotenv()

app = FastAPI(title="FIFA 2026 AI Hub API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Groq Key Management
GROQ_KEYS = [os.getenv(f"fifa{i}") for i in range(1, 6) if os.getenv(f"fifa{i}")]
groq_idx = 0

def get_next_groq_key():
    global groq_idx
    if not GROQ_KEYS:
        return None
    key = GROQ_KEYS[groq_idx]
    groq_idx = (groq_idx + 1) % len(GROQ_KEYS)
    return key

# API-Football Key
API_FOOTBALL_KEY = os.getenv("FOOTBALL_API_KEY")

@app.get("/api/teams")
def get_teams():
    return {"teams": SQUADS}

@app.get("/api/groups")
def get_groups():
    return {"groups": GROUPS}

@app.get("/api/performers")
def get_performers():
    return {"performers": PERFORMERS}

@app.get("/api/auction/pool")
def get_auction_pool():
    # Filter and build auction pool from CSV_PLAYERS
    real_players = [p for p in CSV_PLAYERS if p.get('rating', 0) >= 6.8 and p.get('minutes', 0) > 0]
    
    pool = []
    used = set()
    
    # Simple logic to grab top players by position for auction pool
    for pos in ['Goalkeeper', 'Defender', 'Midfielder', 'Forward']:
        pos_players = sorted([p for p in real_players if p['position'] == pos], key=lambda x: x['rating'], reverse=True)
        for p in pos_players[:15]:  # Take top 15 for each position bucket
            if p['name'] not in used:
                used.add(p['name'])
                
                # Map to specific sub-positions to ensure a variety
                slot = p['position']
                if pos == 'Defender': slot = random.choice(['CB', 'LB', 'RB'])
                elif pos == 'Midfielder': slot = random.choice(['CM', 'CDM', 'CAM'])
                elif pos == 'Forward': slot = random.choice(['ST', 'LW', 'RW'])
                elif pos == 'Goalkeeper': slot = 'GK'

                pool.append({
                    **p,
                    "position": slot,
                    "tier": "Elite" if p['rating'] >= 8.0 else "Star" if p['rating'] >= 7.5 else "Good"
                })
    
    random.shuffle(pool)
    return {"players": pool}

class SimulateRequest(BaseModel):
    userSquad: list
    aiSquad: list

@app.post("/api/auction/simulate")
def simulate_match(req: SimulateRequest):
    user_power = sum(p.get('rating', 7.0) for p in req.userSquad) / len(req.userSquad) if req.userSquad else 7.0
    ai_power = sum(p.get('rating', 7.0) for p in req.aiSquad) / len(req.aiSquad) if req.aiSquad else 7.0
    
    user_power = round(user_power, 2)
    ai_power = round(ai_power, 2)
    
    events = []
    u_score = 0
    a_score = 0
    
    for m in range(5, 91, 12):
        if random.random() < 0.15:
            if random.random() < (user_power / (user_power + ai_power)):
                u_score += 1
                scorer = random.choice(req.userSquad)['name'] if req.userSquad else "User Striker"
                events.append({"min": m, "type": "GOAL", "desc": f"GOAL! {scorer} scores a brilliant strike!", "score": f"{u_score}-{a_score}"})
            else:
                a_score += 1
                scorer = random.choice(req.aiSquad)['name'] if req.aiSquad else "AI Striker"
                events.append({"min": m, "type": "GOAL", "desc": f"GOAL! {scorer} finds the back of the net!", "score": f"{u_score}-{a_score}"})
    
    events.append({"min": 90, "type": "FT", "desc": "Full Time", "score": f"{u_score}-{a_score}"})
    return {"userPower": user_power, "aiPower": ai_power, "events": events}

@app.get("/api/predictor")
def get_predictor():
    r32 = [
        {"id": "R32-1", "home": "Argentina", "away": "Scotland", "homeScore": 2, "awayScore": 0},
        {"id": "R32-2", "home": "France", "away": "Algeria", "homeScore": 3, "awayScore": 1},
        {"id": "R32-3", "home": "Spain", "away": "Senegal", "homeScore": 1, "awayScore": 0},
        {"id": "R32-4", "home": "Brazil", "away": "Norway", "homeScore": 2, "awayScore": 1},
        {"id": "R32-5", "home": "Germany", "away": "Panama", "homeScore": 4, "awayScore": 0},
        {"id": "R32-6", "home": "Portugal", "away": "Ghana", "homeScore": 2, "awayScore": 0},
        {"id": "R32-7", "home": "England", "away": "Uzbekistan", "homeScore": 1, "awayScore": 0},
        {"id": "R32-8", "home": "Netherlands", "away": "Costa Rica", "homeScore": 2, "awayScore": 0},
        {"id": "R32-9", "home": "USA", "away": "Ecuador", "homeScore": 1, "awayScore": 1, "pen": "4-3"},
        {"id": "R32-10", "home": "Mexico", "away": "Sweden", "homeScore": 0, "awayScore": 1},
        {"id": "R32-11", "home": "Colombia", "away": "Morocco", "homeScore": 1, "awayScore": 2},
        {"id": "R32-12", "home": "Uruguay", "away": "Nigeria", "homeScore": 2, "awayScore": 0},
        {"id": "R32-13", "home": "Italy", "away": "Japan", "homeScore": 1, "awayScore": 0},
        {"id": "R32-14", "home": "Croatia", "away": "Canada", "homeScore": 2, "awayScore": 1},
        {"id": "R32-15", "home": "Belgium", "away": "South Korea", "homeScore": 3, "awayScore": 0},
        {"id": "R32-16", "home": "Denmark", "away": "Switzerland", "homeScore": 0, "awayScore": 0, "pen": "3-4"}
    ]
    r16 = [
        {"id": "R16-1", "home": "Argentina", "away": "France", "homeScore": 1, "awayScore": 2},
        {"id": "R16-2", "home": "Spain", "away": "Brazil", "homeScore": 2, "awayScore": 1},
        {"id": "R16-3", "home": "Germany", "away": "Portugal", "homeScore": 1, "awayScore": 1, "pen": "3-4"},
        {"id": "R16-4", "home": "England", "away": "Netherlands", "homeScore": 2, "awayScore": 0},
        {"id": "R16-5", "home": "USA", "away": "Sweden", "homeScore": 0, "awayScore": 2},
        {"id": "R16-6", "home": "Morocco", "away": "Uruguay", "homeScore": 1, "awayScore": 0},
        {"id": "R16-7", "home": "Italy", "away": "Croatia", "homeScore": 0, "awayScore": 0, "pen": "5-4"},
        {"id": "R16-8", "home": "Belgium", "away": "Switzerland", "homeScore": 2, "awayScore": 1}
    ]
    qf = [
        {"id": "QF-1", "home": "France", "away": "Spain", "homeScore": 0, "awayScore": 1},
        {"id": "QF-2", "home": "Portugal", "away": "England", "homeScore": 2, "awayScore": 1},
        {"id": "QF-3", "home": "Sweden", "away": "Morocco", "homeScore": 1, "awayScore": 2},
        {"id": "QF-4", "home": "Italy", "away": "Belgium", "homeScore": 1, "awayScore": 0}
    ]
    sf = [
        {"id": "SF-1", "home": "Spain", "away": "Portugal", "homeScore": 2, "awayScore": 2, "pen": "5-4"},
        {"id": "SF-2", "home": "Morocco", "away": "Italy", "homeScore": 0, "awayScore": 1}
    ]
    final = {"home": "Spain", "away": "Italy", "homeScore": 2, "awayScore": 0, "winner": "Spain"}
    return {"r32": r32, "r16": r16, "qf": qf, "sf": sf, "final": final}

class ChatRequest(BaseModel):
    message: str

@app.post("/api/chat")
async def chat(req: ChatRequest):
    key = get_next_groq_key()
    if not key:
        return {"response": "Groq API key missing from environment variables."}
        
    system_message = """You are a world-class football analyst covering the FIFA World Cup 2026 (USA, Canada, Mexico). 
The tournament is LIVE right now (June 2026). Do NOT reference 2022 Qatar as current.
Provide highly analytical, precise answers like a premium sports data platform (e.g., Sofascore, FotMob, Opta). 
Discuss xG, heatmaps, passing networks, momentum graphs, and advanced tactical transitions.
Limit response to 150-200 words."""

    try:
        async with httpx.AsyncClient() as client:
            res = await client.post(
                "https://api.groq.com/openai/v1/chat/completions",
                json={
                    "model": "llama-3.1-8b-instant",
                    "messages": [
                        {"role": "system", "content": system_message},
                        {"role": "user", "content": req.message}
                    ],
                    "max_tokens": 300,
                    "temperature": 0.7
                },
                headers={"Authorization": f"Bearer {key}"},
                timeout=10.0
            )
            res.raise_for_status()
            data = res.json()
            return {"response": data["choices"][0]["message"]["content"].strip()}
    except Exception as e:
        print(f"Groq Chat Error: {e}")
        return {"response": "I'm currently pulling high-resolution tracking data for this analysis. Check back in a moment!"}

@app.get("/api/live")
async def get_live_matches():
    # Attempt to fetch real live matches from API-Football
    if not API_FOOTBALL_KEY:
        return {"source": "demo_fallback", "fixtures": get_demo_matches()}
        
    today_str = datetime.datetime.utcnow().strftime("%Y-%m-%d")
    try:
        async with httpx.AsyncClient() as client:
            res = await client.get(
                "https://v3.football.api-sports.io/fixtures",
                params={"date": today_str},
                headers={"x-apisports-key": API_FOOTBALL_KEY},
                timeout=5.0
            )
            data = res.json()
            if data.get("response"):
                formatted = [{
                    "id": item["fixture"]["id"],
                    "league": item["league"]["name"],
                    "home": item["teams"]["home"]["name"],
                    "home_logo": item["teams"]["home"]["logo"],
                    "away": item["teams"]["away"]["name"],
                    "away_logo": item["teams"]["away"]["logo"],
                    "score": {"home": item["goals"]["home"] or 0, "away": item["goals"]["away"] or 0},
                    "status": item["fixture"]["status"]["short"],
                    "time": item["fixture"]["status"]["elapsed"] or 0
                } for item in data["response"]]
                return {"source": "api", "fixtures": formatted}
    except Exception as e:
        print(f"API-Football Error: {e}")
    
    return {"source": "demo_fallback", "fixtures": get_demo_matches()}

def get_demo_matches():
    return [
        {"id": "L1", "league": "FIFA World Cup", "home": "Spain", "home_logo": "", "away": "Germany", "away_logo": "", "score": {"home": 1, "away": 1}, "status": "2H", "time": 68},
        {"id": "L2", "league": "FIFA World Cup", "home": "USA", "home_logo": "", "away": "Colombia", "away_logo": "", "score": {"home": 2, "away": 0}, "status": "HT", "time": 45}
    ]
