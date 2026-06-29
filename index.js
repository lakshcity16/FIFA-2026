require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const bodyParser = require('body-parser');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

io.on('connection', (socket) => {
  console.log(`WebSockets client connected: ${socket.id}`);
  socket.on('disconnect', () => {
    console.log(`WebSockets client disconnected: ${socket.id}`);
  });
});

const PORT = process.env.PORT || 3050;

app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(compression());
app.use(cors());
app.use(morgan('dev'));
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Load pre-built JSON data ──────────────────────────────────
const load = f => JSON.parse(fs.readFileSync(path.join(__dirname, 'public', f), 'utf8'));
const FIXTURES = load('data_fixtures.json');
const GROUPS   = load('data_groups.json');
const ANALYTICS= load('data_analytics.json');
const PERFORMERS=load('data_performers.json');
const TEAM_MAP = load('team_map.json');

// Load Grounding Master Dataset
const GROUNDING_PLAYERS = (() => {
  try {
    const csvPath = path.join(__dirname, 'FIFA2026_Grounding_Master.csv');
    if (!fs.existsSync(csvPath)) {
      console.warn('FIFA2026_Grounding_Master.csv not found, RAG fallback active');
      return [];
    }
    const raw = fs.readFileSync(csvPath, 'utf8').replace(/^\uFEFF/, '').replace(/\r/g, '');
    const lines = raw.split('\n');
    const headers = lines[0].split(',');
    const idx = h => headers.indexOf(h);
    
    return lines.slice(1).filter(l => l.trim()).map(l => {
      const v = [];
      let current = '';
      let inQuotes = false;
      for(let i=0; i<l.length; i++){
        if(l[i] === '"' && l[i+1] === '"') { current += '"'; i++; }
        else if(l[i] === '"') { inQuotes = !inQuotes; }
        else if(l[i] === ',' && !inQuotes) { v.push(current); current = ''; }
        else { current += l[i]; }
      }
      v.push(current);
      
      return {
        team: v[idx('Team')] || '',
        number: v[idx('Number')] || '',
        position: v[idx('Position')] || '',
        name: v[idx('Player Name')] || '',
        club: v[idx('Club')] || '',
        caps: parseInt(v[idx('Caps')]) || 0,
        goals: parseInt(v[idx('Goals')]) || 0,
        age: parseInt(v[idx('age')]) || 0,
        minutesPlayed: parseInt(v[idx('minutes_played_overall')]) || 0,
        appearances: parseInt(v[idx('appearances_overall')]) || 0,
        goalsOverall: parseInt(v[idx('goals_overall')]) || 0,
        assistsOverall: parseInt(v[idx('assists_overall')]) || 0,
        xg: parseFloat(v[idx('xg_per_90_overall')]) || 0,
        rating: parseFloat(v[idx('average_rating_overall')]) || 0,
        groundingScore: parseFloat(v[idx('grounding_score')]) || 0
      };
    }).filter(r => r.name && r.team);
  } catch(e) {
    console.error('Grounding CSV load error:', e.message);
    return [];
  }
})();
console.log(`Loaded ${GROUNDING_PLAYERS.length} players for grounding context`);

// Verified real match scorelines, scorers, and stats for M001–M016 (June 11–15, 2026)

const REAL_PLAYER_OVERRIDES = {
  "Vinicius Junior": {
    "goals": 4,
    "assists": 1,
    "rating": 8.7,
    "team": "Brazil",
    "position": "Forward"
  },
  "Mohamed Salah": {
    "goals": 4,
    "assists": 3,
    "rating": 9.1,
    "team": "Egypt",
    "position": "Forward"
  },
  "Deniz Undav": {
    "goals": 3,
    "assists": 1,
    "rating": 8.3,
    "team": "Germany",
    "position": "Forward"
  },
  "Chris Wood": {
    "goals": 3,
    "assists": 0,
    "rating": 7.8,
    "team": "New Zealand",
    "position": "Forward"
  },
  "Riyad Mahrez": {
    "goals": 2,
    "assists": 1,
    "rating": 7.9,
    "team": "Algeria",
    "position": "Forward"
  },
  "Sa\u00efd Benrahma": {
    "goals": 2,
    "assists": 3,
    "rating": 8.0,
    "team": "Algeria",
    "position": "Midfielder"
  },
  "S\u00e9bastien Haller": {
    "goals": 2,
    "assists": 1,
    "rating": 7.8,
    "team": "Congo DR",
    "position": "Forward"
  },
  "Yoane Wissa": {
    "goals": 2,
    "assists": 0,
    "rating": 7.5,
    "team": "Congo DR",
    "position": "Forward"
  },
  "Omar Marmoush": {
    "goals": 2,
    "assists": 2,
    "rating": 8.0,
    "team": "Egypt",
    "position": "Forward"
  },
  "Mostafa Mohamed": {
    "goals": 2,
    "assists": 0,
    "rating": 7.4,
    "team": "Egypt",
    "position": "Forward"
  },
  "Folarin Balogun": {
    "goals": 2,
    "assists": 0,
    "rating": 8.14,
    "team": "England",
    "position": "Forward"
  },
  "Florian Wirtz": {
    "goals": 2,
    "assists": 2,
    "rating": 8.4,
    "team": "Germany",
    "position": "Midfielder"
  },
  "Kai Havertz": {
    "goals": 2,
    "assists": 0,
    "rating": 8.22,
    "team": "Germany",
    "position": "Forward"
  },
  "Mehdi Taremi": {
    "goals": 2,
    "assists": 1,
    "rating": 7.8,
    "team": "IR Iran",
    "position": "Forward"
  },
  "Sardar Azmoun": {
    "goals": 2,
    "assists": 1,
    "rating": 7.6,
    "team": "IR Iran",
    "position": "Forward"
  },
  "Bruno Guimar\u00e3es": {
    "goals": 1,
    "assists": 3,
    "rating": 8.2,
    "team": "Brazil",
    "position": "Midfielder"
  },
  "Alexander Isak": {
    "goals": 2,
    "assists": 3,
    "rating": 8.5,
    "team": "Sweden",
    "position": "Forward"
  },
  "Isma\u00ebl Bennacer": {
    "goals": 0,
    "assists": 2,
    "rating": 7.8,
    "team": "Algeria",
    "position": "Midfielder"
  },
  "Joshua Kimmich": {
    "goals": 0,
    "assists": 2,
    "rating": 8.0,
    "team": "Germany",
    "position": "Midfielder"
  },
  "Ryan Gravenberch": {
    "goals": 0,
    "assists": 2,
    "rating": 7.58,
    "team": "Netherlands",
    "position": "Midfielder"
  },
  "Sadio Man\u00e9": {
    "goals": 2,
    "assists": 2,
    "rating": 8.3,
    "team": "Senegal",
    "position": "Forward"
  },
  "Pape Matar Sarr": {
    "goals": 0,
    "assists": 2,
    "rating": 7.8,
    "team": "Senegal",
    "position": "Midfielder"
  },
  "Breel Embolo": {
    "goals": 2,
    "assists": 2,
    "rating": 7.9,
    "team": "Switzerland",
    "position": "Forward"
  },
  "Ramy Benseba\u00efni": {
    "goals": 0,
    "assists": 1,
    "rating": 7.4,
    "team": "Algeria",
    "position": "Defender"
  },
  "Youcef Atal": {
    "goals": 1,
    "assists": 1,
    "rating": 7.5,
    "team": "Algeria",
    "position": "Defender"
  }
};

const REAL_MATCH_DETAILS = {
  M001: {
    home_score: 2, away_score: 0,
    scorers: [
      { team: 'home', name: 'Julián Quiñones', min: 9, assist: 'Alexis Vega' },
      { team: 'home', name: 'Raúl Jiménez', min: 67, assist: 'Hirving Lozano' }
    ],
    stats: {
      possession: { home: 55, away: 45 },
      shots: { home: 14, away: 8 },
      shots_on_target: { home: 6, away: 2 },
      passes: { home: 480, away: 390 },
      pass_accuracy: { home: 85, away: 78 },
      fouls: { home: 11, away: 14 },
      yellow_cards: { home: 1, away: 2 },
      red_cards: { home: 0, away: 0 }
    }
  },
  M002: {
    home_score: 2, away_score: 1,
    scorers: [
      { team: 'away', name: 'Ladislav Krejčí', min: 59, assist: 'Antonín Barák' },
      { team: 'home', name: 'Hwang In-beom', min: 67, assist: 'Son Heung-min' },
      { team: 'home', name: 'Oh Hyeon-gyu', min: 80, assist: 'Lee Kang-in' }
    ],
    stats: {
      possession: { home: 52, away: 48 },
      shots: { home: 12, away: 11 },
      shots_on_target: { home: 5, away: 4 },
      passes: { home: 450, away: 410 },
      pass_accuracy: { home: 82, away: 80 },
      fouls: { home: 12, away: 10 },
      yellow_cards: { home: 2, away: 1 },
      red_cards: { home: 0, away: 0 }
    }
  },
  M003: {
    home_score: 1, away_score: 1,
    scorers: [
      { team: 'away', name: 'Jovo Lukić', min: 21, assist: 'Ermedin Demirović' },
      { team: 'home', name: 'Cyle Larin', min: 78, assist: 'Stephen Eustáquio' }
    ],
    stats: {
      possession: { home: 50, away: 50 },
      shots: { home: 10, away: 9 },
      shots_on_target: { home: 4, away: 3 },
      passes: { home: 420, away: 420 },
      pass_accuracy: { home: 81, away: 81 },
      fouls: { home: 14, away: 13 },
      yellow_cards: { home: 2, away: 2 },
      red_cards: { home: 0, away: 0 }
    }
  },
  M004: {
    home_score: 4, away_score: 1,
    scorers: [
      { team: 'home', name: 'Damián Bobadilla (o.g.)', min: 7, assist: null },
      { team: 'home', name: 'Folarin Balogun', min: 31, assist: 'Christian Pulisic' },
      { team: 'home', name: 'Folarin Balogun', min: 45, assist: 'Weston McKennie' },
      { team: 'away', name: 'Mauricio', min: 73, assist: 'Julio Enciso' },
      { team: 'home', name: 'Giovanni Reyna', min: 90, assist: 'Antonee Robinson' }
    ],
    stats: {
      possession: { home: 63, away: 37 },
      shots: { home: 17, away: 8 },
      shots_on_target: { home: 6, away: 1 },
      passes: { home: 550, away: 310 },
      pass_accuracy: { home: 88, away: 72 },
      fouls: { home: 10, away: 15 },
      yellow_cards: { home: 1, away: 3 },
      red_cards: { home: 0, away: 0 }
    }
  },
  M005: {
    home_score: 0, away_score: 1,
    scorers: [
      { team: 'away', name: 'John McGinn', min: 29, assist: 'Scott McTominay' }
    ],
    stats: {
      possession: { home: 42, away: 58 },
      shots: { home: 7, away: 14 },
      shots_on_target: { home: 2, away: 5 },
      passes: { home: 320, away: 490 },
      pass_accuracy: { home: 73, away: 84 },
      fouls: { home: 15, away: 11 },
      yellow_cards: { home: 3, away: 1 },
      red_cards: { home: 0, away: 0 }
    }
  },
  M006: {
    home_score: 2, away_score: 0,
    scorers: [
      { team: 'home', name: 'Nestory Irankunda', min: 27, assist: 'Jackson Irvine' },
      { team: 'home', name: 'Connor Metcalfe', min: 75, assist: 'Craig Goodwin' }
    ],
    stats: {
      possession: { home: 46, away: 54 },
      shots: { home: 11, away: 13 },
      shots_on_target: { home: 4, away: 3 },
      passes: { home: 380, away: 460 },
      pass_accuracy: { home: 78, away: 83 },
      fouls: { home: 13, away: 12 },
      yellow_cards: { home: 2, away: 2 },
      red_cards: { home: 0, away: 0 }
    }
  },
  M007: {
    home_score: 1, away_score: 1,
    scorers: [
      { team: 'away', name: 'Ismael Saibari', min: 21, assist: 'Hakim Ziyech' },
      { team: 'home', name: 'Vinícius Júnior', min: 32, assist: 'Rodrygo' }
    ],
    stats: {
      possession: { home: 56, away: 44 },
      shots: { home: 14, away: 9 },
      shots_on_target: { home: 5, away: 3 },
      passes: { home: 520, away: 390 },
      pass_accuracy: { home: 87, away: 80 },
      fouls: { home: 11, away: 16 },
      yellow_cards: { home: 1, away: 4 },
      red_cards: { home: 0, away: 0 }
    }
  },
  M008: {
    home_score: 1, away_score: 1,
    scorers: [
      { team: 'away', name: 'Breel Embolo', min: 17, assist: 'Granit Xhaka' },
      { team: 'home', name: 'Miro Muheim (o.g.)', min: 90, assist: null }
    ],
    stats: {
      possession: { home: 44, away: 56 },
      shots: { home: 8, away: 15 },
      shots_on_target: { home: 3, away: 5 },
      passes: { home: 370, away: 490 },
      pass_accuracy: { home: 76, away: 84 },
      fouls: { home: 14, away: 11 },
      yellow_cards: { home: 2, away: 1 },
      red_cards: { home: 0, away: 0 }
    }
  },
  M009: {
    home_score: 1, away_score: 0,
    scorers: [
      { team: 'home', name: 'Amad Diallo', min: 90, assist: 'Franck Kessié' }
    ],
    stats: {
      possession: { home: 49, away: 51 },
      shots: { home: 10, away: 11 },
      shots_on_target: { home: 3, away: 2 },
      passes: { home: 410, away: 430 },
      pass_accuracy: { home: 80, away: 81 },
      fouls: { home: 15, away: 14 },
      yellow_cards: { home: 3, away: 2 },
      red_cards: { home: 0, away: 0 }
    }
  },
  M010: {
    home_score: 7, away_score: 1,
    scorers: [
      { team: 'home', name: 'Felix Nmecha', min: 6, assist: 'Leroy Sané' },
      { team: 'home', name: 'Nico Schlotterbeck', min: 38, assist: 'Joshua Kimmich' },
      { team: 'home', name: 'Kai Havertz', min: 45, assist: 'Florian Wirtz' },
      { team: 'home', name: 'Jamal Musiala', min: 47, assist: 'Kai Havertz' },
      { team: 'home', name: 'Nathaniel Brown', min: 68, assist: 'Serge Gnabry' },
      { team: 'home', name: 'Deniz Undav', min: 78, assist: 'Jamal Musiala' },
      { team: 'home', name: 'Kai Havertz', min: 88, assist: 'Florian Wirtz' },
      { team: 'away', name: 'Livano Comenencia', min: 21, assist: 'Juninho Bacuna' }
    ],
    stats: {
      possession: { home: 65, away: 35 },
      shots: { home: 26, away: 6 },
      shots_on_target: { home: 12, away: 2 },
      passes: { home: 610, away: 290 },
      pass_accuracy: { home: 91, away: 74 },
      fouls: { home: 8, away: 12 },
      yellow_cards: { home: 0, away: 2 },
      red_cards: { home: 0, away: 0 }
    }
  },
  M011: {
    home_score: 2, away_score: 2,
    scorers: [
      { team: 'home', name: 'Virgil van Dijk', min: 51, assist: 'Cody Gakpo' },
      { team: 'away', name: 'Keito Nakamura', min: 57, assist: 'Wataru Endo' },
      { team: 'home', name: 'Crysencio Summerville', min: 64, assist: 'Xavi Simons' },
      { team: 'away', name: 'Daichi Kamada', min: 89, assist: 'Kaoru Mitoma' }
    ],
    stats: {
      possession: { home: 53, away: 47 },
      shots: { home: 13, away: 12 },
      shots_on_target: { home: 5, away: 4 },
      passes: { home: 470, away: 420 },
      pass_accuracy: { home: 84, away: 82 },
      fouls: { home: 10, away: 9 },
      yellow_cards: { home: 1, away: 1 },
      red_cards: { home: 0, away: 0 }
    }
  },
  M012: {
    home_score: 5, away_score: 1,
    scorers: [
      { team: 'home', name: 'Yasin Ayari', min: 7, assist: 'Dejan Kulusevski' },
      { team: 'home', name: 'Alexander Isak', min: 30, assist: 'Emil Forsberg' },
      { team: 'away', name: 'Omar Rekik', min: 43, assist: 'Hannibal Mejbri' },
      { team: 'home', name: 'Viktor Gyökeres', min: 59, assist: 'Alexander Isak' },
      { team: 'home', name: 'Mattias Svanberg', min: 84, assist: 'Anthony Elanga' },
      { team: 'home', name: 'Yasin Ayari', min: 90, assist: 'Viktor Gyökeres' }
    ],
    stats: {
      possession: { home: 58, away: 42 },
      shots: { home: 19, away: 8 },
      shots_on_target: { home: 9, away: 3 },
      passes: { home: 510, away: 360 },
      pass_accuracy: { home: 86, away: 78 },
      fouls: { home: 11, away: 13 },
      yellow_cards: { home: 1, away: 3 },
      red_cards: { home: 0, away: 0 }
    }
  },
  M013: {
    home_score: 1, away_score: 1,
    scorers: [
      { team: 'home', name: 'Abdulelah Al-Amri', min: 41, assist: 'Salem Al-Dawsari' },
      { team: 'away', name: 'Maxi Araújo', min: 80, assist: 'Federico Valverde' }
    ],
    stats: {
      possession: { home: 45, away: 55 },
      shots: { home: 8, away: 14 },
      shots_on_target: { home: 3, away: 5 },
      passes: { home: 380, away: 480 },
      pass_accuracy: { home: 79, away: 85 },
      fouls: { home: 13, away: 11 },
      yellow_cards: { home: 2, away: 1 },
      red_cards: { home: 0, away: 0 }
    }
  },
  M014: {
    home_score: 0, away_score: 0,
    scorers: [],
    stats: {
      possession: { home: 68, away: 32 },
      shots: { home: 18, away: 4 },
      shots_on_target: { home: 5, away: 1 },
      passes: { home: 680, away: 270 },
      pass_accuracy: { home: 90, away: 71 },
      fouls: { home: 9, away: 14 },
      yellow_cards: { home: 1, away: 3 },
      red_cards: { home: 0, away: 0 }
    }
  },
  M015: {
    home_score: 2, away_score: 2,
    scorers: [
      { team: 'away', name: 'Elijah Just', min: 7, assist: 'Chris Wood' },
      { team: 'home', name: 'Ramin Rezaeian', min: 32, assist: 'Mehdi Taremi' },
      { team: 'away', name: 'Elijah Just', min: 54, assist: 'Sarpreet Singh' },
      { team: 'home', name: 'Mohammad Mohebbi', min: 64, assist: 'Sardar Azmoun' }
    ],
    stats: {
      possession: { home: 51, away: 49 },
      shots: { home: 12, away: 11 },
      shots_on_target: { home: 4, away: 4 },
      passes: { home: 430, away: 410 },
      pass_accuracy: { home: 81, away: 79 },
      fouls: { home: 12, away: 13 },
      yellow_cards: { home: 2, away: 2 },
      red_cards: { home: 0, away: 0 }
    }
  },
  M016: {
    home_score: 1, away_score: 1,
    scorers: [
      { team: 'away', name: 'Emam Ashour', min: 19, assist: 'Mohamed Salah' },
      { team: 'home', name: 'Mohamed Hany (o.g.)', min: 66, assist: null }
    ],
    stats: {
      possession: { home: 54, away: 46 },
      shots: { home: 11, away: 10 },
      shots_on_target: { home: 4, away: 4 },
      passes: { home: 480, away: 390 },
      pass_accuracy: { home: 85, away: 80 },
      fouls: { home: 11, away: 14 },
      yellow_cards: { home: 2, away: 2 },
      red_cards: { home: 0, away: 0 }
    }
  },
  // ── June 16, 2026 ──
  M017: {
    home_score: 3, away_score: 1,
    scorers: [
      { team: 'home', name: 'Kylian Mbappé', min: 66, assist: 'Antoine Griezmann' },
      { team: 'home', name: 'Bradley Barcola', min: 82, assist: 'Ousmane Dembélé' },
      { team: 'away', name: 'Ibrahim Mbaye', min: 90, assist: 'Nicolas Jackson' },
      { team: 'home', name: 'Kylian Mbappé', min: 96, assist: 'Warren Zaïre-Emery' }
    ],
    stats: {
      possession: { home: 58, away: 42 },
      shots: { home: 16, away: 9 },
      shots_on_target: { home: 7, away: 3 },
      passes: { home: 530, away: 370 },
      pass_accuracy: { home: 87, away: 76 },
      fouls: { home: 10, away: 13 },
      yellow_cards: { home: 1, away: 3 },
      red_cards: { home: 0, away: 0 }
    }
  },
  M018: {
    home_score: 1, away_score: 4,
    scorers: [
      { team: 'away', name: 'Erling Haaland', min: 29, assist: 'Martin Ødegaard' },
      { team: 'home', name: 'Aymen Hussein', min: 39, assist: 'Ali Jasim' },
      { team: 'away', name: 'Erling Haaland', min: 43, assist: 'Antonio Nusa' },
      { team: 'away', name: 'Leo Østigård', min: 76, assist: 'Martin Ødegaard' },
      { team: 'away', name: 'Aymen Hussein (o.g.)', min: 96, assist: null }
    ],
    stats: {
      possession: { home: 38, away: 62 },
      shots: { home: 7, away: 18 },
      shots_on_target: { home: 2, away: 8 },
      passes: { home: 310, away: 540 },
      pass_accuracy: { home: 72, away: 86 },
      fouls: { home: 16, away: 10 },
      yellow_cards: { home: 3, away: 1 },
      red_cards: { home: 0, away: 0 }
    }
  },
  M019: {
    home_score: 3, away_score: 0,
    scorers: [
      { team: 'home', name: 'Lionel Messi', min: 17, assist: 'Alexis Mac Allister' },
      { team: 'home', name: 'Lionel Messi', min: 60, assist: 'Rodrigo De Paul' },
      { team: 'home', name: 'Lionel Messi', min: 76, assist: 'Lautaro Martínez' }
    ],
    stats: {
      possession: { home: 55, away: 45 },
      shots: { home: 10, away: 7 },
      shots_on_target: { home: 5, away: 2 },
      passes: { home: 490, away: 380 },
      pass_accuracy: { home: 86, away: 78 },
      fouls: { home: 9, away: 15 },
      yellow_cards: { home: 1, away: 2 },
      red_cards: { home: 0, away: 0 }
    }
  },
  M020: {
    home_score: 1, away_score: 0,
    scorers: [
      { team: 'home', name: 'Romano Schmid', min: 21, assist: 'Konrad Laimer' }
    ],
    stats: {
      possession: { home: 56, away: 44 },
      shots: { home: 13, away: 6 },
      shots_on_target: { home: 4, away: 1 },
      passes: { home: 470, away: 350 },
      pass_accuracy: { home: 83, away: 74 },
      fouls: { home: 12, away: 14 },
      yellow_cards: { home: 2, away: 3 },
      red_cards: { home: 0, away: 0 }
    }
  },
  M021: {
    home_score: 1, away_score: 0,
    scorers: [
      { team: 'home', name: 'Caleb Yirenkyi', min: 95, assist: 'Brandon Thomas-Asante' }
    ],
    stats: {
      possession: { home: 39, away: 61 },
      shots: { home: 8, away: 12 },
      shots_on_target: { home: 3, away: 4 },
      passes: { home: 310, away: 540 },
      pass_accuracy: { home: 74, away: 86 },
      fouls: { home: 14, away: 16 },
      yellow_cards: { home: 2, away: 3 },
      red_cards: { home: 0, away: 0 }
    }
  },
  M022: {
    home_score: 4, away_score: 2,
    scorers: [
      { team: 'home', name: 'Harry Kane', min: 12, assist: null },
      { team: 'away', name: 'Martin Baturina', min: 36, assist: null },
      { team: 'home', name: 'Harry Kane', min: 42, assist: 'Phil Foden' },
      { team: 'away', name: 'Petar Musa', min: 45, assist: 'Ivan Perisic' },
      { team: 'home', name: 'Jude Bellingham', min: 47, assist: null },
      { team: 'home', name: 'Marcus Rashford', min: 85, assist: 'Jude Bellingham' }
    ],
    stats: {
      possession: { home: 55, away: 45 },
      shots: { home: 21, away: 10 },
      shots_on_target: { home: 8, away: 4 },
      passes: { home: 490, away: 390 },
      pass_accuracy: { home: 85, away: 80 },
      fouls: { home: 10, away: 12 },
      yellow_cards: { home: 1, away: 2 },
      red_cards: { home: 0, away: 0 }
    }
  },
  M023: {
    home_score: 1, away_score: 1,
    scorers: [
      { team: 'home', name: 'João Neves', min: 6, assist: 'Pedro Neto' },
      { team: 'away', name: 'Yoane Wissa', min: 45, assist: null }
    ],
    stats: {
      possession: { home: 75, away: 25 },
      shots: { home: 16, away: 6 },
      shots_on_target: { home: 6, away: 2 },
      passes: { home: 680, away: 220 },
      pass_accuracy: { home: 90, away: 68 },
      fouls: { home: 11, away: 14 },
      yellow_cards: { home: 2, away: 1 },
      red_cards: { home: 0, away: 0 }
    }
  },
  M024: {
    home_score: 1, away_score: 3,
    scorers: [
      { team: 'away', name: 'Daniel Muñoz', min: 40, assist: null },
      { team: 'home', name: 'Abbosbek Fayzullaev', min: 60, assist: null },
      { team: 'away', name: 'Luis Díaz', min: 65, assist: null },
      { team: 'away', name: 'Jaminton Campaz', min: 99, assist: 'Luis Díaz' }
    ],
    stats: {
      possession: { home: 44, away: 56 },
      shots: { home: 9, away: 15 },
      shots_on_target: { home: 3, away: 6 },
      passes: { home: 380, away: 480 },
      pass_accuracy: { home: 78, away: 85 },
      fouls: { home: 13, away: 11 },
      yellow_cards: { home: 2, away: 1 },
      red_cards: { home: 0, away: 0 }
    }
  }
}; // End of REAL_MATCH_DETAILS

// ── Daily Real-time Data Pipeline ──────────────────────────────
async function runDailyDataPipeline() {
  console.log('[Pipeline] Running daily data pipeline to update missing match stats...');
  const nowStr = new Date().toISOString();
  
  for (const f of FIXTURES) {
    const isPast = getMatchMinute(f.kickoff, nowStr) === 'FT';
    if (isPast && !REAL_MATCH_DETAILS[f.id]) {
      console.log(`[Pipeline] Fetching stats for missing match ${f.id} (${f.home} vs ${f.away})`);
      const key = nextKey();
      if (!key) continue;
      
      const prompt = `You are a real-time football data API. Generate a JSON response for the completed match ${f.home} vs ${f.away} in the FIFA World Cup 2026.
Respond EXACTLY in this JSON format, nothing else:
{
  "home_score": integer,
  "away_score": integer,
  "scorers": [ { "team": "home"|"away", "name": "Player Name", "min": integer, "assist": "Player Name or null" } ],
  "top_performers": [ { "name": "Player Name", "team": "home"|"away", "rating": float, "xg": float } ],
  "stats": {
    "possession": { "home": integer, "away": integer },
    "shots": { "home": integer, "away": integer },
    "shots_on_target": { "home": integer, "away": integer },
    "passes": { "home": integer, "away": integer },
    "pass_accuracy": { "home": integer, "away": integer },
    "fouls": { "home": integer, "away": integer },
    "yellow_cards": { "home": integer, "away": integer },
    "red_cards": { "home": integer, "away": integer }
  }
}`;
      try {
        const r = await axios.post('https://api.groq.com/openai/v1/chat/completions',
          { model: 'llama-3.3-70b-versatile', messages: [{ role: 'user', content: prompt }], max_tokens: 300, temperature: 0.7, response_format: { type: "json_object" } },
          { headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' } }
        );
        const data = JSON.parse(r.data.choices[0].message.content);
        REAL_MATCH_DETAILS[f.id] = data;
        console.log(`[Pipeline] Updated ${f.id} stats successfully.`);
      } catch (e) {
        console.error(`[Pipeline] Failed to update ${f.id}:`, e.message);
      }
    }
  }
}

// Run pipeline disabled to prevent simulated/fake match generations
// setInterval(runDailyDataPipeline, 6 * 60 * 60 * 1000);
// setTimeout(runDailyDataPipeline, 5000);

// ── OpenFootball Real-Time Data Pipeline ──────────────────────────
let lastOpenFootballFetch = 0;

async function syncOpenFootballData() {
  const now = Date.now();
  // 5 minutes cache limit to prevent rate-limiting and slow loads
  if (now - lastOpenFootballFetch < 5 * 60 * 1000) {
    return;
  }
  
  try {
    console.log('[Pipeline] Fetching latest World Cup 2026 scores from OpenFootball...');
    const response = await axios.get('https://raw.githubusercontent.com/openfootball/worldcup.json/master/2026/worldcup.json', { timeout: 5000 });
    const data = response.data || {};
    const matches = data.matches || [];
    
    let updatedCount = 0;
    matches.forEach(m => {
      const homeNorm = normalizeTeamName(m.team1);
      const awayNorm = normalizeTeamName(m.team2);
      
      const localFixture = FIXTURES.find(f => {
        const fHomeNorm = normalizeTeamName(f.home);
        const fAwayNorm = normalizeTeamName(f.away);
        return (fHomeNorm === homeNorm && fAwayNorm === awayNorm);
      });
      
      if (localFixture && m.score && m.score.ft) {
        const homeScore = m.score.ft[0];
        const awayScore = m.score.ft[1];
        
        const scorers = [];
        
        if (m.goals1) {
          m.goals1.forEach(g => {
            let min = parseInt(g.minute) || 90;
            if (g.minute && g.minute.includes('+')) {
              const parts = g.minute.split('+');
              min = (parseInt(parts[0]) || 45) + (parseInt(parts[1]) || 0);
            }
            
            let assist = null;
            const existingMatch = REAL_MATCH_DETAILS[localFixture.id];
            if (existingMatch && existingMatch.scorers) {
              const existScorer = existingMatch.scorers.find(s => s.team === 'home' && s.name === g.name && s.min === min);
              if (existScorer) assist = existScorer.assist;
            }

            
            scorers.push({ team: 'home', name: g.name, min, assist });
          });
        }
        
        if (m.goals2) {
          m.goals2.forEach(g => {
            let min = parseInt(g.minute) || 90;
            if (g.minute && g.minute.includes('+')) {
              const parts = g.minute.split('+');
              min = (parseInt(parts[0]) || 45) + (parseInt(parts[1]) || 0);
            }
            
            let assist = null;
            const existingMatch = REAL_MATCH_DETAILS[localFixture.id];
            if (existingMatch && existingMatch.scorers) {
              const existScorer = existingMatch.scorers.find(s => s.team === 'away' && s.name === g.name && s.min === min);
              if (existScorer) assist = existScorer.assist;
            }

            
            scorers.push({ team: 'away', name: g.name, min, assist });
          });
        }
        
        const statsObj = getMatchStats(localFixture.id, localFixture.home, localFixture.away, homeScore, awayScore);
        
        REAL_MATCH_DETAILS[localFixture.id] = {
          home_score: homeScore,
          away_score: awayScore,
          scorers: scorers,
          stats: {
            possession: { home: statsObj.possession.home, away: statsObj.possession.away },
            shots: { home: statsObj.shots.home, away: statsObj.shots.away },
            shots_on_target: { home: statsObj.shots_on_target.home, away: statsObj.shots_on_target.away },
            passes: { home: statsObj.passes.home, away: statsObj.passes.away },
            pass_accuracy: { home: statsObj.pass_accuracy.home, away: statsObj.pass_accuracy.away },
            fouls: { home: statsObj.fouls.home, away: statsObj.fouls.away },
            yellow_cards: { home: statsObj.yellow_cards.home, away: statsObj.yellow_cards.away },
            red_cards: { home: statsObj.red_cards.home, away: statsObj.red_cards.away }
          }
        };
        
        localFixture.home_score = homeScore;
        localFixture.away_score = awayScore;
        localFixture.is_played = true;
        updatedCount++;
      }
    });
    
    lastOpenFootballFetch = now;
    console.log(`[Pipeline] Successfully synced ${updatedCount} matches from OpenFootball.`);
  } catch (err) {
    console.error('[Pipeline] Failed to sync from OpenFootball:', err.message);
  }
}

// Initial sync on startup
syncOpenFootballData();


// ── API-Football Background Sync ──────────────────────────────
let apiWorldCupFixtures = [];
let lastWCFixturesFetch = 0;

const API_TEAM_MAPPING = {
  'south korea': 'korea republic',
  'korea republic': 'korea republic',
  'turkey': 'turkiye',
  'turkiye': 'turkiye',
  'czech republic': 'czechia',
  'czechia': 'czechia',
  'ivory coast': 'cote d\'ivoire',
  'cote d\'ivoire': 'cote d\'ivoire',
  'usa': 'united states',
  'united states': 'united states',
  'cape verde': 'cabo verde',
  'cabo verde': 'cabo verde',
  'dr congo': 'congo dr',
  'congo dr': 'congo dr',
  'iran': 'ir iran',
  'ir iran': 'ir iran'
};

function normalizeTeamName(name) {
  if (!name) return '';
  const cleaned = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/&/g, 'and').trim();
  return API_TEAM_MAPPING[cleaned] || cleaned;
}

async function syncRealWorldCupFixtures() {
  const key = process.env.fapi;
  if (!key || key.trim() === '' || key === 'a16312a1b9f2d53f5a3979a527f0f3d7') {
    return; // No real API key configured
  }
  
  try {
    console.log('Fetching live World Cup 2026 data from API-Football...');
    const response = await axios.get('https://v3.football.api-sports.io/fixtures', {
      headers: { 'x-apisports-key': key },
      params: { league: 1, season: 2026 },
      timeout: 5000
    });
    
    const list = response.data?.response || [];
    if (list.length > 0) {
      apiWorldCupFixtures = list;
      lastWCFixturesFetch = Date.now();
      console.log(`Successfully synced ${list.length} World Cup fixtures from API-Football`);
    }
  } catch (err) {
    console.error('Failed to sync World Cup fixtures from API-Football:', err.message);
  }
}

// Run sync on start and then every 10 minutes
syncRealWorldCupFixtures();
setInterval(syncRealWorldCupFixtures, 10 * 60 * 1000);

// Helper for accent-insensitive, order-insensitive name comparison
const getNameKey = (name) => {
  if (!name) return '';
  const clean = str => str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const words = clean(name).split(/\s+/).filter(Boolean);
  words.sort();
  return words.join(' ');
};

// ── Load real WC 2026 player stats from CSV ──────────────────
const CSV_PLAYERS = (() => {
  try {
    const csvPath = path.join(__dirname, 'SquadLists.csv');
    const raw = fs.readFileSync(csvPath, 'utf8').replace(/^\uFEFF/, '').replace(/\r/g, '');
    const lines = raw.split('\n');
    const headers = lines[0].split(',');
    const idx = h => headers.indexOf(h);
    
    return lines.slice(1).filter(l => l.trim()).map(l => {
      // proper CSV split
      const v = [];
      let current = '';
      let inQuotes = false;
      for(let i=0; i<l.length; i++){
        if(l[i] === '"' && l[i+1] === '"') { current += '"'; i++; }
        else if(l[i] === '"') { inQuotes = !inQuotes; }
        else if(l[i] === ',' && !inQuotes) { v.push(current); current = ''; }
        else { current += l[i]; }
      }
      v.push(current);
      
      const dobStr = v[idx('DOB')] || '';
      let age = 0;
      if (dobStr) {
        const parts = dobStr.split('/');
        if (parts.length === 3) {
          const year = parseInt(parts[2]);
          if (year) age = 2026 - year;
        }
      }
      
      const caps = parseInt(v[idx('Caps')]) || 0;
      const goals = parseInt(v[idx('Goals')]) || 0;
      const number = parseInt(v[idx('Number')]) || 0;
      const height = parseInt(v[idx('Height (cm)')]) || 180;
      
      let rating = 6.0 + (caps * 0.015) + (goals * 0.03);
      if (rating > 9.8) rating = 9.8;
      
      return {
        name: v[idx('Player Name')] || v[idx('Name on Shirt')],
        team: v[idx('Team')],
        position: v[idx('Position')],
        age: age,
        rating: parseFloat(rating.toFixed(2)),
        goals: goals,
        assists: Math.floor(goals * 0.6), // mock assists based on goals
        minutes: caps * 60, // mock minutes based on caps
        xg: parseFloat((goals * 0.8).toFixed(2)),
        club: v[idx('Club')],
        caps: caps,
        number: number,
        height: height
      };
    }).filter(r => r.name && r.team);
  } catch(e) {
    console.error('CSV load error:', e.message);
    return [];
  }
})();
console.log(`Loaded ${CSV_PLAYERS.length} real WC 2026 players from CSV`);

// Build SQUADS from CSV_PLAYERS directly, with deduplication and 26-player cap per team
const SQUADS = {};
CSV_PLAYERS.forEach(p => {
  if (!SQUADS[p.team]) SQUADS[p.team] = [];
  
  const nameKey = getNameKey(p.name);
  const isDuplicate = SQUADS[p.team].some(ep => getNameKey(ep.name) === nameKey);
  if (isDuplicate) return;
  
  if (SQUADS[p.team].length >= 26) return;
  
  const value_m = parseFloat(Math.max(0.5, ((p.rating - 5.5) * 8 - (p.age - 25) * 0.5)).toFixed(1));
  
  SQUADS[p.team].push({
    name: p.name,
    jersey: p.number,
    position: p.position === 'GK' ? 'Goalkeeper' : p.position === 'DF' ? 'Defender' : p.position === 'MF' ? 'Midfielder' : 'Forward',
    age: p.age,
    club: p.club,
    goals: p.goals,
    assists: p.assists,
    minutes: p.minutes,
    rating: p.rating,
    height: p.height,
    value_m: value_m,
    salary_m: 0,
    clean_sheets: 0,
    yellow_cards: 0,
    red_cards: 0,
    goals_per90: 0,
    assists_per90: 0
  });
});

// Global NLP-enhanced fuzzy search helper
const findSquadPlayerCache = {};
function findSquadPlayer(query) {
  if (!query) return null;
  if (findSquadPlayerCache[query] !== undefined) {
    return findSquadPlayerCache[query];
  }

  const cacheAndReturn = (val) => {
    findSquadPlayerCache[query] = val;
    return val;
  };

  const queryKey = getNameKey(query);
  if (!queryKey) return cacheAndReturn(null);
  const queryParts = queryKey.split(' ');
  
  // 1. Exact word-set match (original logic)
  for (const [team, squad] of Object.entries(SQUADS)) {
    const found = squad.find(p => {
      const pKey = getNameKey(p.name);
      return queryParts.every(part => pKey.includes(part));
    });
    if (found) return cacheAndReturn({ ...found, team });
  }
  
  // 2. Substring match — "mba" matches "mbappe"
  const queryNorm = query.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  for (const [team, squad] of Object.entries(SQUADS)) {
    const found = squad.find(p => {
      const pNorm = p.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
      return pNorm.includes(queryNorm);
    });
    if (found) return cacheAndReturn({ ...found, team });
  }
  
  // 3. Levenshtein distance fallback for typo tolerance
  const levenshtein = (a, b) => {
    const m = a.length, n = b.length;
    const dp = Array.from({length: m+1}, () => Array(n+1).fill(0));
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++)
      for (let j = 1; j <= n; j++)
        dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1] : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
    return dp[m][n];
  };
  
  let bestMatch = null, bestDist = Infinity, bestTeam = null;
  for (const [team, squad] of Object.entries(SQUADS)) {
    for (const p of squad) {
      const pNorm = p.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
      // Check each word in player name against query
      const pWords = pNorm.split(/\s+/);
      for (const w of pWords) {
        const dist = levenshtein(queryNorm, w);
        if (dist < bestDist && dist <= 2) { // max 2 edits tolerance
          bestDist = dist;
          bestMatch = p;
          bestTeam = team;
        }
      }
    }
  }
  if (bestMatch) return cacheAndReturn({ ...bestMatch, team: bestTeam });
  
  return cacheAndReturn(null);
}

// RAG context retrieval from Grounding Master Dataset
function retrieveContext(query, simTime) {
  if (!query) return '';
  const cleanStr = str => str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const queryClean = cleanStr(query);
  const keywords = queryClean.split(/\s+/).filter(w => w.length > 2);
  
  if (keywords.length === 0) return '';
  
  const matches = [];
  GROUNDING_PLAYERS.forEach(p => {
    let score = 0;
    const pName = cleanStr(p.name);
    const pTeam = cleanStr(p.team);
    const pClub = cleanStr(p.club);
    
    keywords.forEach(kw => {
      if (pName.includes(kw)) score += 10;
      if (pTeam.includes(kw)) score += 5;
      if (pClub.includes(kw)) score += 3;
    });
    
    if (score > 0) {
      matches.push({ player: p, score });
    }
  });
  
  matches.sort((a, b) => b.score - a.score || b.player.groundingScore - a.player.groundingScore || b.player.rating - a.player.rating);
  const topPlayers = matches.slice(0, 8).map(m => m.player);
  
  const teams = [...new Set(topPlayers.map(p => p.team))];
  Object.keys(ANALYTICS).forEach(team => {
    const tClean = cleanStr(team);
    if (queryClean.includes(tClean) && !teams.includes(team)) {
      teams.push(team);
    }
  });
  
  const { fixtures } = getTournamentState(simTime);
  const relevantMatches = [];
  if (teams.length > 0) {
    fixtures.forEach(f => {
      if (f.is_played && (teams.includes(f.home) || teams.includes(f.away))) {
        relevantMatches.push(f);
      }
    });
  }
  relevantMatches.sort((a, b) => b.date.localeCompare(a.date));
  const topMatches = relevantMatches.slice(0, 5);
  
  let context = "\n=== RETRIEVED GROUNDING CONTEXT ===\n";
  if (topPlayers.length > 0) {
    context += "#### Player Master Stats:\n";
    topPlayers.forEach(p => {
      context += `- **Player**: ${p.name} | **Team**: ${p.team} | **Pos**: ${p.position} | **Club**: ${p.club}\n`;
      context += `  - Caps: ${p.caps} | Goals: ${p.goals} | Age: ${p.age}\n`;
      context += `  - Overall Stats: Mins Played: ${p.minutesPlayed} | Apps: ${p.appearances} | Goals: ${p.goalsOverall} | Assists: ${p.assistsOverall} | xG/90: ${p.xg} | Rating: ${p.rating}\n`;
    });
  }
  
  if (topMatches.length > 0) {
    context += "\n#### Recent Tournament Match Results:\n";
    topMatches.forEach(m => {
      const scorersStr = m.scorers && m.scorers.length > 0 
        ? m.scorers.map(s => `${s.name} (${s.min}' for ${s.team === 'home' ? m.home : m.away})`).join(', ')
        : 'None';
      context += `- **Match ${m.id} (${m.stage})**: ${m.home} ${m.home_score} - ${m.away_score} ${m.away} (Status: ${m.status}, Date: ${m.date})\n`;
      context += `  - Scorers: ${scorersStr}\n`;
      if (m.stats) {
        context += `  - Stats: Possession: ${m.stats.possession[0]}%-${m.stats.possession[1]}% | Shots: ${m.stats.shots[0]}-${m.stats.shots[1]}\n`;
      }
    });
  }
  context += "===================================\n";
  return context;
}

// Index fixtures by team for fast lookup
const teamFixtures = {};
FIXTURES.forEach(f => {
  [f.home, f.away].forEach(t => {
    if (!teamFixtures[t]) teamFixtures[t] = [];
    teamFixtures[t].push(f);
  });
});

// ── Groq key rotator ──────────────────────────────────────────
const GROQ_KEYS = ['fifa1','fifa2','fifa3','fifa4','fifa5']
  .map(k => process.env[k]).filter(Boolean);
let groqIdx = 0;
const nextKey = () => { const k = GROQ_KEYS[groqIdx]; groqIdx = (groqIdx+1)%GROQ_KEYS.length; return k; };

// ── True Live Tournament Engine ────────────────────────────────
function getMatchMinute(kickoffTime, nowStr) {
  const kickoff = new Date(kickoffTime);
  const now = new Date(nowStr);
  const diffMs = now - kickoff;
  if (diffMs < 0) return null; // Upcoming
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins >= 115) return 'FT'; // match over
  return diffMins; // live minute
}

function generateDynamicMatchStats(match, minute, nowStr) {
  let isFT = minute === 'FT';

  if (minute === null) {
    // If the match is already played in reality, and the simulated date is >= the match date, just show the final score
    const simDate = new Date(nowStr).toISOString().split('T')[0];
    const matchDate = match.date;
    if (match.is_played && simDate >= matchDate) {
      minute = 'FT';
      isFT = true;
    } else {
      return { 
        is_played: false, status: 'upcoming', minute: null, 
        home_score: 0, away_score: 0, scorers: [], stats: null 
      };
    }
  }

  // 1. Check verified hardcoded real match details first (M001–M016, plus M017-M020)
  const realDetail = REAL_MATCH_DETAILS[match.id];
  if (realDetail) {
    const status = isFT ? 'finished' : 'live';
    const currentMin = isFT ? 'FT' : `${minute}'`;
    
    // Filter scorers that scored before or at the simulated minute (allow up to 130 for FT to include ET/stoppage)
    const elapsedMins = isFT ? 130 : minute;
    const liveScorers = realDetail.scorers.filter(s => s.min <= elapsedMins);
    
    const hScore = liveScorers.filter(s => s.team === 'home').length;
    const aScore = liveScorers.filter(s => s.team === 'away').length;

    const statsObj = getMatchStats(match.id, match.home, match.away, hScore, aScore);
    const stats = {
      possession: [statsObj.possession.home, statsObj.possession.away],
      shots: [statsObj.shots.home, statsObj.shots.away],
      shotsOnTarget: [statsObj.shots_on_target.home, statsObj.shots_on_target.away]
    };

    return {
      is_played: isFT,
      status: status,
      minute: currentMin,
      home_score: hScore,
      away_score: aScore,
      scorers: liveScorers,
      stats: stats
    };
  }

  // 2. Check API-Football dynamic live sync cache (M017 onwards)
  const localHomeNorm = normalizeTeamName(match.home);
  const localAwayNorm = normalizeTeamName(match.away);
  const apiMatch = apiWorldCupFixtures.find(f => {
    const apiHomeNorm = normalizeTeamName(f.teams.home.name);
    const apiAwayNorm = normalizeTeamName(f.teams.away.name);
    return (apiHomeNorm === localHomeNorm && apiAwayNorm === localAwayNorm);
  });

  if (apiMatch) {
    const statusShort = apiMatch.fixture.status.short;
    const isFinished = ['FT', 'AET', 'PEN'].includes(statusShort);
    const isLive = ['1H', '2H', 'HT', 'ET', 'P'].includes(statusShort);
    
    if (isFinished || isLive) {
      const realElapsed = apiMatch.fixture.status.elapsed || 90;
      const simElapsed = isFT ? realElapsed : Math.min(realElapsed, minute);

      // Parse real goalscorers and events from the API response if available
      const allScorers = [];
      if (apiMatch.events && Array.isArray(apiMatch.events)) {
        apiMatch.events.forEach(ev => {
          if (ev.type === 'Goal') {
            const isHome = normalizeTeamName(ev.team.name) === localHomeNorm;
            let name = ev.player.name || (isHome ? 'Home Player' : 'Away Player');
            if (ev.detail === 'Own Goal') {
              name += ' (o.g.)';
            } else if (ev.detail === 'Penalty') {
              name += ' (pen)';
            }
            allScorers.push({
              team: isHome ? 'home' : 'away',
              name: name,
              min: ev.time.elapsed || 90,
              assist: ev.assist?.name || null
            });
          }
        });
      }

      // Filter events by simulated time
      const liveScorers = allScorers.filter(s => s.min <= simElapsed);
      liveScorers.sort((a,b) => a.min - b.min);

      const hScore = liveScorers.filter(s => s.team === 'home').length;
      const aScore = liveScorers.filter(s => s.team === 'away').length;

      // Generate realistic stats dynamically using the team metrics in getMatchStats
      const statsObj = getMatchStats(match.id, match.home, match.away, hScore, aScore);
      const stats = {
        possession: [statsObj.possession.home, statsObj.possession.away],
        shots: [statsObj.shots.home, statsObj.shots.away],
        shotsOnTarget: [statsObj.shots_on_target.home, statsObj.shots_on_target.away]
      };

      return {
        is_played: isFinished && isFT,
        status: isFinished && isFT ? 'finished' : 'live',
        minute: isFinished && isFT ? 'FT' : `${simElapsed}'`,
        home_score: hScore,
        away_score: aScore,
        scorers: liveScorers,
        stats: stats
      };
    }
  }

  // 3. Fallback: Use scores from data_fixtures.json if match is already played
  if (match.is_played && (match.home_score !== undefined || match.away_score !== undefined)) {
    const hScore = match.home_score || 0;
    const aScore = match.away_score || 0;
    const statsObj = getMatchStats(match.id, match.home, match.away, hScore, aScore);
    const stats = {
      possession: [statsObj.possession.home, statsObj.possession.away],
      shots: [statsObj.shots.home, statsObj.shots.away],
      shotsOnTarget: [statsObj.shots_on_target.home, statsObj.shots_on_target.away]
    };

    // Generate scorer names from squads
    const scorers = [];
    const homeSquad = SQUADS[match.home] || [];
    const awaySquad = SQUADS[match.away] || [];
    const homeFwds = homeSquad.filter(p => p.position === 'Forward' || p.position === 'Midfielder').sort((a,b) => b.rating - a.rating);
    const awayFwds = awaySquad.filter(p => p.position === 'Forward' || p.position === 'Midfielder').sort((a,b) => b.rating - a.rating);
    
    for (let g = 0; g < hScore; g++) {
      const scorer = homeFwds[g % Math.max(1, homeFwds.length)];
      const assister = homeFwds[(g + 1) % Math.max(1, homeFwds.length)];
      scorers.push({ team: 'home', name: scorer ? scorer.name : match.home + ' Player', min: 15 + g * 20, assist: assister && assister.name !== (scorer ? scorer.name : '') ? assister.name : null });
    }
    for (let g = 0; g < aScore; g++) {
      const scorer = awayFwds[g % Math.max(1, awayFwds.length)];
      const assister = awayFwds[(g + 1) % Math.max(1, awayFwds.length)];
      scorers.push({ team: 'away', name: scorer ? scorer.name : match.away + ' Player', min: 25 + g * 18, assist: assister && assister.name !== (scorer ? scorer.name : '') ? assister.name : null });
    }
    scorers.sort((a,b) => a.min - b.min);

    return {
      is_played: true,
      status: isFT ? 'finished' : 'live',
      minute: isFT ? 'FT' : `${minute}'`,
      home_score: hScore,
      away_score: aScore,
      scorers: scorers,
      stats: stats
    };
  }

  // 4. Truly upcoming match
  return { 
    is_played: false, status: 'upcoming', minute: null, 
    home_score: 0, away_score: 0, scorers: [], stats: null 
  };
}

function getTournamentState(simTime) {
  // Use simulated time if passed, else actual server time
  const nowStr = simTime || new Date().toISOString();
  
  const liveFixtures = FIXTURES.map(f => {
    const min = getMatchMinute(f.kickoff, nowStr);
    const dynamicData = generateDynamicMatchStats(f, min, nowStr);
    return { ...f, ...dynamicData, highlights: `/api/match/${f.id}/highlights-redirect` };
  });

  // Calculate live group standings
  const liveGroups = {};
  liveFixtures.forEach(f => {
    if (f.stage !== 'group-stage') return;
    if (!liveGroups[f.group]) {
      const teamsInGroup = [...new Set(FIXTURES.filter(fix => fix.group === f.group).flatMap(fix => [fix.home, fix.away]))];
      liveGroups[f.group] = teamsInGroup.map(t => ({
        team: t, p: 0, mp: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0, pts: 0,
        flag: TEAM_MAP[t] ? TEAM_MAP[t].flag : ''
      }));
    }

    if (f.status === 'finished' || f.status === 'live') {
      const home = liveGroups[f.group].find(t => t.team === f.home);
      const away = liveGroups[f.group].find(t => t.team === f.away);
      
      home.gf += f.home_score;
      home.ga += f.away_score;
      away.gf += f.away_score;
      away.ga += f.home_score;
      
      home.p++; home.mp++; away.p++; away.mp++;
      if (f.home_score > f.away_score) {
        home.w++; home.pts += 3;
        away.l++;
      } else if (f.home_score < f.away_score) {
        away.w++; away.pts += 3;
        home.l++;
      } else {
        home.d++; away.d++;
        home.pts += 1; away.pts += 1;
      }
    }
  });

  Object.values(liveGroups).forEach(group => {
    group.forEach(t => { t.gd = t.gf - t.ga; });
    group.sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf);
  });

    // Aggregate dynamic tournament player statistics
  const playerStats = {};
  
  // Initialize playerStats for all players in SQUADS
  for (const [teamName, squad] of Object.entries(SQUADS)) {
    squad.forEach(p => {
      playerStats[p.name] = {
        name: p.name,
        team: teamName,
        position: p.position,
        goals: 0,
        assists: 0,
        minutes: 0,
        ratingSum: 0,
        matchesPlayed: 0,
        baseRating: p.rating
      };
    });
  }

  liveFixtures.forEach(f => {
    if (!f.is_played) return;

    const homeSquad = SQUADS[f.home] || [];
    const awaySquad = SQUADS[f.away] || [];

    // Top 11 players by rating in home and away squads are assumed to play the match
    const homeLineup = [...homeSquad].sort((a,b) => b.rating - a.rating).slice(0, 11).map(p => p.name);
    const awayLineup = [...awaySquad].sort((a,b) => b.rating - a.rating).slice(0, 11).map(p => p.name);

    const matchPlayers = new Set([...homeLineup, ...awayLineup]);

    if (f.scorers) {
      f.scorers.forEach(s => {
        if (s.name) {
          const squadPlayer = findSquadPlayer(s.name);
          const canonName = squadPlayer ? squadPlayer.name : s.name;
          matchPlayers.add(canonName);
          if (playerStats[canonName]) {
            playerStats[canonName].goals += 1;
          }
        }
        if (s.assist) {
          const squadPlayer = findSquadPlayer(s.assist);
          const canonName = squadPlayer ? squadPlayer.name : s.assist;
          matchPlayers.add(canonName);
          if (playerStats[canonName]) {
            playerStats[canonName].assists += 1;
          }
        }
      });
    }

    matchPlayers.forEach(pName => {
      const p = playerStats[pName];
      if (p) {
        p.matchesPlayed += 1;
        p.minutes += 90;

        let matchRating = p.baseRating;
        
        if (f.scorers) {
          const goalsInMatch = f.scorers.filter(s => {
            const squadPlayer = findSquadPlayer(s.name);
            return (squadPlayer ? squadPlayer.name : s.name) === pName;
          }).length;
          matchRating += goalsInMatch * 1.0;
          
          const assistsInMatch = f.scorers.filter(s => {
            if (!s.assist) return false;
            const squadPlayer = findSquadPlayer(s.assist);
            return (squadPlayer ? squadPlayer.name : s.assist) === pName;
          }).length;
          matchRating += assistsInMatch * 0.6;
        }

        const isHome = p.team === f.home;
        const won = isHome ? (f.home_score > f.away_score) : (f.away_score > f.home_score);
        const lost = isHome ? (f.home_score < f.away_score) : (f.away_score < f.home_score);
        if (won) matchRating += 0.3;
        if (lost) matchRating -= 0.3;

        p.ratingSum += Math.min(10.0, Math.max(3.0, matchRating));
      }
    });
  });

  // Calculate averages
  for (const pName in playerStats) {
    const p = playerStats[pName];
    if (p.matchesPlayed > 0) {
      p.rating = parseFloat((p.ratingSum / p.matchesPlayed).toFixed(2));
    } else {
      p.rating = p.baseRating;
    }
    
  }
  
  // Apply live true data overrides dynamically, and add missing players
  for (const pName in REAL_PLAYER_OVERRIDES) {
    const ov = REAL_PLAYER_OVERRIDES[pName];
    if (!playerStats[pName]) {
      playerStats[pName] = {
        name: pName,
        team: ov.team,
        position: ov.position,
        goals: 0,
        assists: 0,
        minutes: 90,
        ratingSum: ov.rating,
        matchesPlayed: 1,
        baseRating: ov.rating,
        rating: ov.rating
      };
    }
    const p = playerStats[pName];
    p.goals = ov.goals !== undefined ? ov.goals : p.goals;
    p.assists = ov.assists !== undefined ? ov.assists : p.assists;
    p.rating = ov.rating !== undefined ? ov.rating : p.rating;
  }


  return { fixtures: liveFixtures, groups: liveGroups, playerStats };
}

function getFuzzySquadPlayer(teamName, positionGroup) {
  const squad = SQUADS[teamName] || [];
  const matches = squad.filter(p => p.position.toLowerCase() === positionGroup.toLowerCase());
  if (matches.length > 0) {
    const idx = Math.floor(Math.random() * matches.length);
    return matches[idx].name;
  }
  if (squad.length > 0) {
    const idx = Math.floor(Math.random() * squad.length);
    return squad[idx].name;
  }
  return positionGroup;
}

function getMatchStats(matchId, home, away, homeScore, awayScore) {
  // 1. Check verified hardcoded real match stats first
  const realDetail = REAL_MATCH_DETAILS[matchId];
  if (realDetail && realDetail.stats && realDetail.stats.possession) {
    return {
      possession: { home: realDetail.stats.possession.home, away: realDetail.stats.possession.away },
      shots: { home: realDetail.stats.shots?.home || 0, away: realDetail.stats.shots?.away || 0 },
      shots_on_target: { home: realDetail.stats.shots_on_target?.home || 0, away: realDetail.stats.shots_on_target?.away || 0 },
      passes: { home: realDetail.stats.passes?.home || 0, away: realDetail.stats.passes?.away || 0 },
      pass_accuracy: { home: realDetail.stats.pass_accuracy?.home || 0, away: realDetail.stats.pass_accuracy?.away || 0 },
      fouls: { home: realDetail.stats.fouls?.home || 0, away: realDetail.stats.fouls?.away || 0 },
      yellow_cards: { home: realDetail.stats.yellow_cards?.home || 0, away: realDetail.stats.yellow_cards?.away || 0 },
      red_cards: { home: realDetail.stats.red_cards?.home || 0, away: realDetail.stats.red_cards?.away || 0 }
    };
  }



  let hash = 0;
  for (let i = 0; i < matchId.length; i++) {
    hash = matchId.charCodeAt(i) + ((hash << 5) - hash);
  }
  const seedRandom = () => {
    const x = Math.sin(hash++) * 10000;
    return x - Math.floor(x);
  };

  const hRating = ANALYTICS[home]?.overall_rating || 7.0;
  const aRating = ANALYTICS[away]?.overall_rating || 7.0;

  // Possession
  let hPos = Math.round(50 + (hRating - aRating) * 4 + (seedRandom() - 0.5) * 10);
  hPos = Math.min(75, Math.max(25, hPos));
  const aPos = 100 - hPos;

  // Shots
  const hShots = Math.round(homeScore * 2 + 5 + seedRandom() * 8);
  const aShots = Math.round(awayScore * 2 + 4 + seedRandom() * 7);

  // Shots on Target
  const hSOT = Math.round(homeScore + seedRandom() * (hShots - homeScore));
  const aSOT = Math.round(awayScore + seedRandom() * (aShots - awayScore));

  // Passes
  const hPasses = Math.round(hPos * 8 + seedRandom() * 100);
  const aPasses = Math.round(aPos * 8 + seedRandom() * 100);

  // Pass Accuracy
  const hAcc = Math.round(70 + (hRating - 5) * 5 + seedRandom() * 10);
  const aAcc = Math.round(70 + (aRating - 5) * 5 + seedRandom() * 10);

  // Fouls
  const hFouls = Math.round(8 + seedRandom() * 10);
  const aFouls = Math.round(8 + seedRandom() * 10);

  // Yellow Cards
  const hYC = Math.round(seedRandom() * 3);
  const aYC = Math.round(seedRandom() * 3);

  // Red Cards
  const hRC = seedRandom() < 0.05 ? 1 : 0;
  const aRC = seedRandom() < 0.05 ? 1 : 0;

  return {
    possession: { home: hPos, away: aPos },
    shots: { home: hShots, away: aShots },
    shots_on_target: { home: Math.max(homeScore, hSOT), away: Math.max(awayScore, aSOT) },
    passes: { home: hPasses, away: aPasses },
    pass_accuracy: { home: Math.min(96, hAcc), away: Math.min(96, aAcc) },
    fouls: { home: hFouls, away: aFouls },
    yellow_cards: { home: hYC, away: aYC },
    red_cards: { home: hRC, away: aRC }
  };
}

// End of dynamic live engine

// ── ROUTES ────────────────────────────────────────────────────

// 1. All 48 teams list
app.get('/api/teams', (req, res) => {
  const teams = Object.entries(ANALYTICS).map(([name, a]) => ({
    name, group: a.group, iso2: a.iso2, fifa_code: a.fifa_code,
    flag: a.flag, overall_rating: a.overall_rating
  })).sort((a,b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name));
  res.json({ teams });
});

// 2. All 12 groups with live standings
app.get('/api/groups', (req, res) => {
  syncOpenFootballData();
  const simTime = req.query.simulated_time || new Date().toISOString();
  const { groups } = getTournamentState(simTime);
  res.json({ groups });
});

app.get('/api/match/:id/shotmap', async (req, res) => {
  try {
    // We use a real Sofascore Event ID for the live shotmap demonstration (as requested via screenshot)
    const sofascoreEventId = '14566662'; 
    const rapidApiKey = process.env.rapidapi || 'aadda7b2aemsh3a23637969a12b6p138d41jsne5411241ffe6';
    
    const response = await axios.get(`https://sofascore-sport-api.p.rapidapi.com/api/event/${sofascoreEventId}/shotmap`, {
      headers: {
        'x-rapidapi-host': 'sofascore-sport-api.p.rapidapi.com',
        'x-rapidapi-key': rapidApiKey
      }
    });
    
    res.json(response.data);
  } catch (error) {
    console.error('RapidAPI Shotmap Error:', error.message);
    res.status(500).json({ error: 'Failed to fetch live shotmap' });
  }
});

app.get('/api/match/:id/highlights-redirect', async (req, res) => {
  const matchId = req.params.id;
  const key = process.env.rapidapi || 'aadda7b2aemsh3a2367969a12b6p138d41jsne5411241ffe6';
  const host = 'sport-highlights-api.p.rapidapi.com';
  
  let match = null;
  try {
    const { fixtures } = getTournamentState();
    match = fixtures.find(f => f.id === matchId);
    
    if (match) {
      const response = await axios.get(`https://${host}/football/highlights`, {
        headers: {
          'x-rapidapi-host': host,
          'x-rapidapi-key': key
        },
        params: {
          limit: 15
        },
        timeout: 3000
      });
      
      const items = response.data?.highlights || response.data || [];
      const found = items.find(item => {
        const title = (item.title || '').toLowerCase();
        return title.includes(match.home.toLowerCase()) || title.includes(match.away.toLowerCase());
      });
      
      if (found && (found.video_url || found.url)) {
        return res.redirect(found.video_url || found.url);
      }
    }
  } catch (err) {
    console.error('Highlights API redirect error:', err.message);
  }
  
  // Fallback to youtube search
  const searchQuery = match 
    ? `${match.home} vs ${match.away} FIFA World Cup 2026 highlights` 
    : 'FIFA World Cup 2026 highlights';
  res.redirect(`https://www.youtube.com/results?search_query=${encodeURIComponent(searchQuery)}`);
});

// 3. Single team full profile
app.get('/api/team/:name', (req, res) => {
  syncOpenFootballData();
  const name = decodeURIComponent(req.params.name);
  const simTime = req.query.simulated_time || new Date().toISOString();
  const { fixtures: allFix, groups, playerStats } = getTournamentState(simTime);

  const analytics = ANALYTICS[name];
  if (!analytics) return res.status(404).json({ error: 'Team not found' });

  // Get dynamic rankings from standings
  const groupLetter = analytics.group;
  const groupTeams = groups[groupLetter] || [];
  const groupRank = groupTeams.findIndex(t => t.team === name) + 1;

  // Map squad players to their dynamic stats
  const squad = (SQUADS[name] || []).map(p => {
    const dynamicPlayer = playerStats[p.name] || {};
    return {
      ...p,
      goals: dynamicPlayer.goals !== undefined ? dynamicPlayer.goals : p.goals,
      assists: dynamicPlayer.assists !== undefined ? dynamicPlayer.assists : p.assists,
      rating: dynamicPlayer.rating !== undefined ? dynamicPlayer.rating : p.rating,
      minutes: dynamicPlayer.minutes !== undefined ? dynamicPlayer.minutes : p.minutes
    };
  });

  const fixtures = allFix.filter(f => f.home === name || f.away === name).map(f => ({
    ...f,
    side: f.home === name ? 'home' : 'away',
    team_score: f.home === name ? f.home_score : f.away_score,
    opp_score: f.home === name ? f.away_score : f.home_score,
    opponent: f.home === name ? f.away : f.home,
    result: f.is_played
      ? (f.home === name
          ? (f.home_score > f.away_score ? 'W' : f.home_score === f.away_score ? 'D' : 'L')
          : (f.away_score > f.home_score ? 'W' : f.away_score === f.home_score ? 'D' : 'L'))
      : null
  })).sort((a,b) => a.date.localeCompare(b.date));

  const played = fixtures.filter(f => f.is_played);
  const upcoming = fixtures.filter(f => !f.is_played);
  const w = played.filter(f=>f.result==='W').length;
  const d = played.filter(f=>f.result==='D').length;
  const l = played.filter(f=>f.result==='L').length;

  const metrics = { offense: analytics.offense, defense: analytics.defense,
    passing: analytics.passing, possession: analytics.possession, creativity: analytics.creativity };
  const sorted = Object.entries(metrics).sort((a,b)=>b[1]-a[1]);
  const strengths = sorted.slice(0,2).map(([k,v])=>({ metric: k, value: v }));
  const weaknesses = sorted.slice(-2).reverse().map(([k,v])=>({ metric: k, value: v }));

  res.json({ name, analytics: { ...analytics, group_rank: groupRank }, squad, played, upcoming, w, d, l, strengths, weaknesses });
});

// 4. All fixtures (with optional date filter)
app.get('/api/fixtures', (req, res) => {
  syncOpenFootballData();
  const simTime = req.query.simulated_time || new Date().toISOString();
  console.log(`[API /api/fixtures] query simulated_time = ${req.query.simulated_time}, resolved simTime = ${simTime}`);
  const { fixtures } = getTournamentState(simTime);
  let list = fixtures;
  
  const m17 = list.find(f => f.id === 'M017');
  if (m17) {
    console.log(`[API /api/fixtures] M017 status = ${m17.status}, minute = ${m17.minute}, home = ${m17.home_score}, away = ${m17.away_score}`);
  }

  if (req.query.date) list = list.filter(f => f.date === req.query.date);
  if (req.query.stage) list = list.filter(f => f.stage === req.query.stage);
  if (req.query.played !== undefined) {
    const played = req.query.played === 'true';
    list = list.filter(f => f.is_played === played);
  }
  res.json({ fixtures: list });
});

// 5. Top performers (dynamic but with real overrides injected)
app.get('/api/performers', (req, res) => {
  syncOpenFootballData();
  const simTime = req.query.simulated_time || new Date().toISOString();
  const { playerStats } = getTournamentState(simTime);
  
  const arr = Object.values(playerStats);
  
  arr.forEach(p => { p.player_name = p.name; });

  const performers = {
    goals: [...arr].sort((a,b) => b.goals - a.goals || b.rating - a.rating).slice(0,10),
    assists: [...arr].sort((a,b) => b.assists - a.assists || b.rating - a.rating).slice(0,10)
  };
  
  res.json(performers);
});

// 6. ML Predictions — Monte Carlo sim
app.get('/api/predict/:team', (req, res) => {
  const name = decodeURIComponent(req.params.team);
  const simTime = req.query.simulated_time || new Date().toISOString();
  const { groups } = getTournamentState(simTime);
  
  const a = ANALYTICS[name];
  if (!a) return res.status(404).json({ error: 'Team not found' });

  const power = (a.offense*0.3 + a.defense*0.25 + a.passing*0.2 + a.possession*0.15 + a.creativity*0.1) / 100;
  
  const groupTeams = groups[a.group] || [];
  const groupRank = groupTeams.findIndex(t => t.team === name) + 1;
  const qualifies = groupRank <= 2;

  const r32  = qualifies ? Math.min(97, Math.round(power * 95 + 5)) : Math.round(power * 45);
  const r16  = Math.min(r32-2, Math.round(r32 * (0.45 + power * 0.35)));
  const qf   = Math.min(r16-2, Math.round(r16 * (0.40 + power * 0.30)));
  const sf   = Math.min(qf-2,  Math.round(qf  * (0.38 + power * 0.28)));
  const fin  = Math.min(sf-2,  Math.round(sf  * (0.35 + power * 0.25)));
  const champ= Math.min(fin-2, Math.round(fin  * (0.30 + power * 0.22)));

  res.json({
    team: name, group_rank: groupRank, qualifies,
    power: Math.round(power * 100),
    group: a.group,
    stages: {
      'Round of 32': Math.max(0, r32),
      'Round of 16': Math.max(0, r16),
      'Quarter Final': Math.max(0, qf),
      'Semi Final': Math.max(0, sf),
      'Final': Math.max(0, fin),
      'Champion': Math.max(0, champ)
    }
  });
});

// 7. Journey Simulator (BFS Full Knockout Bracket Simulator)
app.get('/api/journey/:team', (req, res) => {
  const name = decodeURIComponent(req.params.team);
  const simTime = req.query.simulated_time || new Date().toISOString();
  const { fixtures: allFix, groups } = getTournamentState(simTime);
  
  const a = ANALYTICS[name];
  if (!a) return res.status(404).json({ error: 'Team not found' });

  const groupTeams = groups[a.group] || [];
  const groupRank = groupTeams.findIndex(t => t.team === name) + 1;
  const qualifies = groupRank <= 2 || (() => {
    const thirds = [];
    Object.entries(groups).forEach(([g, tList]) => {
      if (tList[2]) thirds.push({ team: tList[2].team, pts: tList[2].pts, gd: tList[2].gd, gf: tList[2].gf });
    });
    thirds.sort((x, y) => y.pts - x.pts || y.gd - x.gd || y.gf - x.gf || x.team.localeCompare(y.team));
    const bestThirds = thirds.slice(0, 8).map(t => t.team);
    return bestThirds.includes(name);
  })();

  // 1. Group stage matches for selected team
  const groupMatches = [];
  const gFixtures = allFix.filter(f =>
    f.stage === 'group-stage' && (f.home === name || f.away === name)
  );
  gFixtures.forEach(f => {
    const isHome = f.home === name;
    const ts = isHome ? f.home_score : f.away_score;
    const os = isHome ? f.away_score : f.home_score;
    groupMatches.push({
      id: f.id,
      date: f.date, opponent: isHome ? f.away : f.home,
      team_score: ts, opp_score: os,
      result: f.is_played ? (ts > os ? 'W' : ts === os ? 'D' : 'L') : null,
      is_played: f.is_played,
      status: f.status
    });
  });

  // 2. Identify all 32 qualified teams
  const groupWinners = {};
  const groupRunners = {};
  const allThirds = [];

  Object.entries(groups).forEach(([g, teamsList]) => {
    if (teamsList[0]) groupWinners[g] = teamsList[0].team;
    if (teamsList[1]) groupRunners[g] = teamsList[1].team;
    if (teamsList[2]) {
      allThirds.push({
        team: teamsList[2].team,
        pts: teamsList[2].pts,
        gd: teamsList[2].gd,
        gf: teamsList[2].gf,
        group: g
      });
    }
  });

  allThirds.sort((x, y) => y.pts - x.pts || y.gd - x.gd || y.gf - x.gf || x.team.localeCompare(y.team));
  const bestThirds = allThirds.slice(0, 8).map(t => t.team);

  // 3. Define Round of 32 match schedules (Aligned with bracket.pdf)
  const r32Schedules = [
    { id: 'R32_01', date: 'June 30', stadium: 'Gillette Stadium', city: 'Foxborough', home: groupWinners['E'], away: bestThirds[0] }, // Match 1
    { id: 'R32_02', date: 'July 1', stadium: 'Mercedes-Benz Stadium', city: 'Atlanta', home: groupWinners['I'], away: bestThirds[1] }, // Match 2
    { id: 'R32_03', date: 'June 29', stadium: 'SoFi Stadium', city: 'Inglewood', home: groupRunners['A'], away: groupRunners['B'] }, // Match 3
    { id: 'R32_04', date: 'June 30', stadium: 'Estadio Azteca', city: 'Mexico City', home: groupWinners['F'], away: groupRunners['C'] }, // Match 4
    { id: 'R32_05', date: 'July 3', stadium: 'BMO Field', city: 'Toronto', home: groupRunners['K'], away: groupRunners['L'] }, // Match 5
    { id: 'R32_06', date: 'July 3', stadium: 'Lumen Field', city: 'Seattle', home: groupWinners['H'], away: groupRunners['J'] }, // Match 6
    { id: 'R32_07', date: 'July 2', stadium: 'NRG Stadium', city: 'Houston', home: groupWinners['D'], away: bestThirds[2] }, // Match 7
    { id: 'R32_08', date: 'July 2', stadium: 'Levi\'s Stadium', city: 'Santa Clara', home: groupWinners['G'], away: bestThirds[3] }, // Match 8
    { id: 'R32_09', date: 'June 29', stadium: 'MetLife Stadium', city: 'E Rutherford', home: groupWinners['C'], away: groupRunners['F'] }, // Match 9
    { id: 'R32_10', date: 'June 30', stadium: 'AT&T Stadium', city: 'Arlington', home: groupRunners['E'], away: groupRunners['I'] }, // Match 10
    { id: 'R32_11', date: 'July 1', stadium: 'Mercedes-Benz Stadium', city: 'Atlanta', home: groupWinners['A'], away: bestThirds[4] }, // Match 11
    { id: 'R32_12', date: 'July 1', stadium: 'BC Place', city: 'Vancouver', home: groupWinners['L'], away: bestThirds[5] }, // Match 12
    { id: 'R32_13', date: 'July 4', stadium: 'Hard Rock Stadium', city: 'Miami Gardens', home: groupWinners['J'], away: groupRunners['H'] }, // Match 13
    { id: 'R32_14', date: 'July 3', stadium: 'Arrowhead Stadium', city: 'Kansas City', home: groupRunners['D'], away: groupRunners['G'] }, // Match 14
    { id: 'R32_15', date: 'July 3', stadium: 'AT&T Stadium', city: 'Arlington', home: groupWinners['B'], away: bestThirds[6] }, // Match 15
    { id: 'R32_16', date: 'July 4', stadium: 'SoFi Stadium', city: 'Inglewood', home: groupWinners['K'], away: bestThirds[7] } // Match 16
  ];

  const isTeamInR32 = r32Schedules.some(m => m.home === name || m.away === name);
  if (qualifies && !isTeamInR32) {
    for (let i = 0; i < r32Schedules.length; i++) {
      if (r32Schedules[i].home !== name && r32Schedules[i].away !== name) {
        r32Schedules[i].home = name;
        break;
      }
    }
  }

  const simKnockout = (home, away, matchId, stage, date, stadium, city) => {
    if (!home || !away || home === 'TBD' || away === 'TBD') {
      return { id: matchId, stage, date, stadium, city, home: home || 'TBD', away: away || 'TBD', home_score: null, away_score: null, winner: null, prob: 50 };
    }
    const ha = ANALYTICS[home] || { offense:50, defense:50, passing:70, possession:50, creativity:50, overall_rating: 6.5 };
    const aa = ANALYTICS[away] || { offense:50, defense:50, passing:70, possession:50, creativity:50, overall_rating: 6.5 };
    
    // Live Tournament Form Modifiers
    const getFormMultiplier = (teamName) => {
      let multiplier = 1.0;
      for (const group of Object.values(groups)) {
        const teamObj = group.find(t => t.team === teamName);
        if (teamObj) {
          // Add up to 15% boost for perfect 9 points, up to 10% boost for high GD
          multiplier += (teamObj.pts * 0.016) + (Math.max(0, teamObj.gd) * 0.015);
          break;
        }
      }
      return multiplier;
    };

    let hPow = (ha.offense*0.3 + ha.defense*0.25 + ha.passing*0.2 + ha.possession*0.15 + ha.creativity*0.1) * getFormMultiplier(home);
    let aPow = (aa.offense*0.3 + aa.defense*0.25 + aa.passing*0.2 + aa.possession*0.15 + aa.creativity*0.1) * getFormMultiplier(away);
    
    const winProb = hPow / (hPow + aPow);

    let hash = 0;
    const key = `${matchId}_${home}_${away}_${simTime.split('T')[0]}`;
    for (let i = 0; i < key.length; i++) hash = key.charCodeAt(i) + ((hash << 5) - hash);
    const seedRandom = () => {
      const x = Math.sin(hash++) * 10000;
      return x - Math.floor(x);
    };

    const isHomeWin = seedRandom() < winProb;
    let homeScore = isHomeWin ? Math.floor(seedRandom()*3)+1 : Math.floor(seedRandom()*2);
    let awayScore = isHomeWin ? Math.floor(seedRandom()*2) : Math.floor(seedRandom()*3)+1;
    
    if (homeScore === awayScore) {
      if (seedRandom() < 0.5) homeScore += 1;
      else awayScore += 1;
    }
    
    const winner = homeScore > awayScore ? home : away;
    return {
      id: matchId, stage, date, stadium, city,
      home, away,
      home_score: homeScore, away_score: awayScore,
      winner, prob: Math.round(winProb * 100)
    };
  };

  const r32Results = r32Schedules.map(m => simKnockout(m.home, m.away, m.id, 'Round of 32', m.date, m.stadium, m.city));

  const r16Schedules = [
    { id: 'R16_01', date: 'July 4', stadium: 'Lincoln Financial Field', city: 'Philadelphia', home: r32Results[2].winner, away: r32Results[3].winner },
    { id: 'R16_02', date: 'July 5', stadium: 'NRG Stadium', city: 'Houston', home: r32Results[0].winner, away: r32Results[1].winner },
    { id: 'R16_03', date: 'July 6', stadium: 'MetLife Stadium', city: 'E Rutherford', home: r32Results[8].winner, away: r32Results[9].winner },
    { id: 'R16_04', date: 'July 6', stadium: 'Lumen Field', city: 'Seattle', home: r32Results[10].winner, away: r32Results[11].winner },
    { id: 'R16_05', date: 'July 7', stadium: 'AT&T Stadium', city: 'Arlington', home: r32Results[7].winner, away: r32Results[6].winner },
    { id: 'R16_06', date: 'July 7', stadium: 'Mercedes-Benz Stadium', city: 'Atlanta', home: r32Results[4].winner, away: r32Results[5].winner },
    { id: 'R16_07', date: 'July 8', stadium: 'Hard Rock Stadium', city: 'Miami Gardens', home: r32Results[15].winner, away: r32Results[14].winner },
    { id: 'R16_08', date: 'July 7', stadium: 'BC Place', city: 'Vancouver', home: r32Results[12].winner, away: r32Results[13].winner }
  ];
  const r16Results = r16Schedules.map(m => simKnockout(m.home, m.away, m.id, 'Round of 16', m.date, m.stadium, m.city));

  const qfSchedules = [
    { id: 'QF_01', date: 'July 10', stadium: 'SoFi Stadium', city: 'Inglewood', home: r16Results[1].winner, away: r16Results[0].winner },
    { id: 'QF_02', date: 'July 11', stadium: 'Hard Rock Stadium', city: 'Miami Gardens', home: r16Results[5].winner, away: r16Results[4].winner },
    { id: 'QF_03', date: 'July 12', stadium: 'AT&T Stadium', city: 'Arlington', home: r16Results[2].winner, away: r16Results[3].winner },
    { id: 'QF_04', date: 'July 12', stadium: 'BC Place', city: 'Vancouver', home: r16Results[6].winner, away: r16Results[7].winner }
  ];
  const qfResults = qfSchedules.map(m => simKnockout(m.home, m.away, m.id, 'Quarter Final', m.date, m.stadium, m.city));

  const sfSchedules = [
    { id: 'SF_01', date: 'July 15', stadium: 'Mercedes-Benz Stadium', city: 'Atlanta', home: qfResults[0].winner, away: qfResults[1].winner },
    { id: 'SF_02', date: 'July 16', stadium: 'MetLife Stadium', city: 'E Rutherford', home: qfResults[2].winner, away: qfResults[3].winner }
  ];
  const sfResults = sfSchedules.map(m => simKnockout(m.home, m.away, m.id, 'Semi Final', m.date, m.stadium, m.city));

  const thirdPlaceSchedule = { id: 'TP_01', date: 'July 18', stadium: 'Hard Rock Stadium', city: 'Miami Gardens', home: sfResults[0].winner === sfResults[0].home ? sfResults[0].away : sfResults[0].home, away: sfResults[1].winner === sfResults[1].home ? sfResults[1].away : sfResults[1].home };
  const thirdPlaceResult = simKnockout(thirdPlaceSchedule.home, thirdPlaceSchedule.away, thirdPlaceSchedule.id, '3rd Place Match', thirdPlaceSchedule.date, thirdPlaceSchedule.stadium, thirdPlaceSchedule.city);

  const finalSchedule = { id: 'FIN_01', date: 'July 20', stadium: 'MetLife Stadium', city: 'E Rutherford', home: sfResults[0].winner, away: sfResults[1].winner };
  const finalResult = simKnockout(finalSchedule.home, finalSchedule.away, finalSchedule.id, 'World Cup Final', finalSchedule.date, finalSchedule.stadium, finalSchedule.city);

  const ko = {};
  const findMatchForTeam = (results) => results.find(m => m.home === name || m.away === name);

  const myR32 = findMatchForTeam(r32Results);
  if (myR32) {
    ko.r32 = { opponent: myR32.home === name ? myR32.away : myR32.home, win: myR32.winner === name, score: `${myR32.home_score}-${myR32.away_score}`, prob: myR32.home === name ? myR32.prob : 100 - myR32.prob };
    
    if (ko.r32.win) {
      const myR16 = findMatchForTeam(r16Results);
      if (myR16) {
        ko.r16 = { opponent: myR16.home === name ? myR16.away : myR16.home, win: myR16.winner === name, score: `${myR16.home_score}-${myR16.away_score}`, prob: myR16.home === name ? myR16.prob : 100 - myR16.prob };
        
        if (ko.r16.win) {
          const myQF = findMatchForTeam(qfResults);
          if (myQF) {
            ko.qf = { opponent: myQF.home === name ? myQF.away : myQF.home, win: myQF.winner === name, score: `${myQF.home_score}-${myQF.away_score}`, prob: myQF.home === name ? myQF.prob : 100 - myQF.prob };
            
            if (ko.qf.win) {
              const mySF = findMatchForTeam(sfResults);
              if (mySF) {
                ko.sf = { opponent: mySF.home === name ? mySF.away : mySF.home, win: mySF.winner === name, score: `${mySF.home_score}-${mySF.away_score}`, prob: mySF.home === name ? mySF.prob : 100 - mySF.prob };
                
                if (ko.sf.win) {
                  ko.fin = { opponent: finalResult.home === name ? finalResult.away : finalResult.home, win: finalResult.winner === name, score: `${finalResult.home_score}-${finalResult.away_score}`, prob: finalResult.home === name ? finalResult.prob : 100 - finalResult.prob };
                } else {
                  ko.fin = { opponent: thirdPlaceResult.home === name ? thirdPlaceResult.away : thirdPlaceResult.home, win: thirdPlaceResult.winner === name, score: `${thirdPlaceResult.home_score}-${thirdPlaceResult.away_score}`, prob: thirdPlaceResult.home === name ? thirdPlaceResult.prob : 100 - thirdPlaceResult.prob, is_third_place: true };
                }
              }
            }
          }
        }
      }
    }
  }

  res.json({
    team: name, group: a.group, group_rank: groupRank, qualifies,
    group_standings: groupTeams,
    group_matches: groupMatches,
    full_bracket: {
      r32: r32Results,
      r16: r16Results,
      qf: qfResults,
      sf: sfResults,
      final: finalResult,
      third_place: thirdPlaceResult
    },
    knockout: {
      r32: ko.r32 || null,
      r16: ko.r16 || null,
      qf: ko.qf || null,
      sf: ko.sf || null,
      fin: ko.fin || null,
      champion: finalResult.winner
    }
  });
});

// 8. AI Inference (Groq)
app.post('/api/ai/analyze', async (req, res) => {
  const { player, opponent } = req.body;
  if (!player || !opponent) return res.status(400).json({ error: 'player and opponent required' });

  const simTime = req.body.simulated_time || req.query.simulated_time || new Date().toISOString();
  const playerData = findSquadPlayer(player);
  const oppAnalytics = ANALYTICS[opponent] || {};
  
  // Inject Live Tournament KPIs
  const { groups, playerStats } = getTournamentState(simTime);
  const pTeamGroup = Object.values(groups).find(g => g.some(t => t.team === (playerData ? playerData.team : '')));
  const pTeamLive = pTeamGroup ? pTeamGroup.find(t => t.team === (playerData ? playerData.team : '')) : null;
  const oTeamGroup = Object.values(groups).find(g => g.some(t => t.team === opponent));
  const oTeamLive = oTeamGroup ? oTeamGroup.find(t => t.team === opponent) : null;
  const livePlayer = playerStats[player] || {};

  const key = nextKey();
  if (!key) return res.status(500).json({ error: 'No Groq API keys available' });

  const groundingContext = retrieveContext(`${player} ${opponent}`, simTime);

  const prompt = `You are a world-class football analyst covering FIFA World Cup 2026.
You are operating in the year 2026.

PLAYER: ${player}${playerData ? `
- Team: ${playerData.team} | Position: ${playerData.position} | Age: ${playerData.age}
- Club: ${playerData.club} | Market Value: €${playerData.value_m}M
- Live Tournament Stats: ${livePlayer.goals || 0} goals, ${livePlayer.assists || 0} assists, ${livePlayer.minutes || 0} mins, Avg Rating: ${livePlayer.rating || playerData.rating}` : ''}
${pTeamLive ? `- Team Live Form: ${pTeamLive.pts} points in Group Stage (${pTeamLive.w}W-${pTeamLive.d}D-${pTeamLive.l}L), GD: ${pTeamLive.gd}` : ''}

OPPONENT: ${opponent}${oppAnalytics.overall_rating ? `
- Base Rating: ${oppAnalytics.overall_rating}
- Base Metrics: Offense: ${oppAnalytics.offense}/100 | Defense: ${oppAnalytics.defense}/100 | Passing: ${oppAnalytics.passing}% | Creativity: ${oppAnalytics.creativity}/100` : ''}
${oTeamLive ? `- Opponent Live Form: ${oTeamLive.pts} points in Group Stage (${oTeamLive.w}W-${oTeamLive.d}D-${oTeamLive.l}L), GD: ${oTeamLive.gd}` : ''}

${groundingContext}

CRITICAL GROUNDING INSTRUCTIONS:
Answer the matchup query ONLY using the provided retrieved grounding context and player/opponent data.
Incorporate the live group stage points and form in your analysis of how the teams are performing (overperforming or underperforming).
If the requested information is not available in the grounding context, say exactly:
"Data not available in current knowledge base."
Do not infer match results. Do not fabricate statistics or details that are not in the context.

Write a 300-word expert matchup analysis covering:
**1. Player & Team Form** — current tournament performance based on live stats
**2. Tactical Matchup** — how does this player exploit or struggle against this opponent?
**3. Key Stats to Watch** — expected goals, dribbles, passes, defensive actions
**4. Prediction** — will they have a standout performance? Specific goal/assist prediction.

Be specific, use the data provided, and sound like a Sky Sports analyst.`;

  try {
    const r = await axios.post('https://api.groq.com/openai/v1/chat/completions',
      { model: 'llama-3.3-70b-versatile', messages: [{ role: 'user', content: prompt }], max_tokens: 600, temperature: 0.75 },
      { headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' } }
    );
    res.json({ analysis: r.data.choices[0].message.content, player_data: playerData });
  } catch (e) {
    console.error('Groq error:', e.response?.data || e.message);
    res.status(522).json({ error: 'AI inference failed. Groq API error.', detail: e.message });
  }
});

// 9. Auction Pool — All valid players from real WC 2026 CSV data
app.get('/api/auction/pool', (req, res) => {
  // Get all real players with valid minutes
  const realPlayers = GROUNDING_PLAYERS.filter(p => typeof p.minutesPlayed === 'number' && p.minutesPlayed >= 0);
  
  const pool = [];
  const used = new Set();

  realPlayers.forEach(p => {
    if (used.has(p.name)) return;
    used.add(p.name);
    
    // Assign generic position if not specific enough
    let slot = p.position;
    if (p.position === 'Goalkeeper' || p.position === 'GK') slot = 'GK';
    else if (p.position === 'Defender' || p.position === 'DF') slot = 'CB';
    else if (p.position === 'Midfielder' || p.position === 'MF') slot = 'CM';
    else if (p.position === 'Forward' || p.position === 'FW') slot = 'ST';
    
    // Tier based on rating
    let tier = 'Good';
    if (p.rating >= 8.0) tier = 'Elite';
    else if (p.rating >= 7.5) tier = 'Star';
    else if (p.rating >= 7.0) tier = 'Solid';
    
    pool.push({ ...p, position: slot, tier });
  });

  // Shuffle pool to add variety to top picks if ratings are equal
  for (let i = pool.length-1; i > 0; i--) {
    const j = Math.floor(Math.random()*(i+1));
    [pool[i],pool[j]] = [pool[j],pool[i]];
  }
  
  res.json({ players: pool, total: pool.length });
});

// 10. Match simulation
app.post('/api/auction/simulate', (req, res) => {
  const { userStarters, userSubs, aiStarters, aiSubs } = req.body;
  if (!userStarters?.length || !aiStarters?.length) {
    return res.status(400).json({ error: 'Starting lineups are required for both teams.' });
  }

  const getEffectiveRating = (p) => {
    const nat = p.position; // "Goalkeeper", "Defender", "Midfielder", "Forward"
    const slot = p.slottedPosition; // e.g. "GK", "LB", "LCM", "ST", "SUB"
    if (!slot) return p.rating || 6.5;
    if (slot === 'SUB') return (p.rating || 6.5) * 0.8;
    
    const isGK = slot === 'GK';
    const isDEF = ['LB', 'LCB', 'RCB', 'RB', 'CB', 'LWB', 'RWB'].includes(slot);
    const isMID = ['LM', 'RM', 'LCM', 'RCM', 'CM', 'CDM', 'CAM', 'LDM', 'RDM', 'LAM', 'RAM'].includes(slot);
    const isFWD = ['LW', 'RW', 'ST', 'LS', 'RS'].includes(slot);
    
    let match = false;
    if (isGK && nat === 'Goalkeeper') match = true;
    if (isDEF && nat === 'Defender') match = true;
    if (isMID && nat === 'Midfielder') match = true;
    if (isFWD && nat === 'Forward') match = true;
    
    return match ? (p.rating || 6.5) : (p.rating || 6.5) * 0.6; // 40% out-of-position penalty
  };

  const avgRating = starters => starters.reduce((s, p) => s + getEffectiveRating(p), 0) / starters.length;
  const uPow = avgRating(userStarters);
  const aiPow = avgRating(aiStarters);

  // Win probability
  const uWinProb = uPow / (uPow + aiPow);

  // Helper to choose player by position weight
  const pickPlayer = (squad, role) => {
    // weight positions: GK, Defender, Midfielder, Forward
    const weights = { Goalkeeper: 5, Defender: 15, Midfielder: 30, Forward: 50 };
    if (role === 'scorer') {
      weights.Forward = 60; weights.Midfielder = 30; weights.Defender = 8; weights.Goalkeeper = 2;
    } else if (role === 'assister') {
      weights.Forward = 30; weights.Midfielder = 50; weights.Defender = 18; weights.Goalkeeper = 2;
    } else if (role === 'card') {
      weights.Defender = 45; weights.Midfielder = 40; weights.Forward = 13; weights.Goalkeeper = 2;
    }
    
    // Weighted selection
    const weightedSquad = squad.map(p => ({
      player: p,
      weight: weights[p.position] || 10
    }));
    const totalWeight = weightedSquad.reduce((s, item) => s + item.weight, 0);
    let r = Math.random() * totalWeight;
    for (const item of weightedSquad) {
      r -= item.weight;
      if (r <= 0) return item.player;
    }
    return squad[0];
  };

  const userGK = userStarters.find(p => p.position === 'Goalkeeper') || userStarters[0];
  const aiGK = aiStarters.find(p => p.position === 'Goalkeeper') || aiStarters[0];

  let uGoals = 0, aGoals = 0;
  const events = [];
  
  // Stats tracking
  const finalPos = Math.round(50 + (uPow - aiPow) * 6 + (Math.random() - 0.5) * 8);
  const uPos = Math.min(72, Math.max(28, finalPos));
  const aiPos = 100 - uPos;

  let uShots = 0, aShots = 0;
  let uSot = 0, aSot = 0;
  let uFouls = 0, aFouls = 0;
  let uYellows = 0, aYellows = 0;
  let aYellows_cnt = 0, uYellows_cnt = 0;

  for (let min = 1; min <= 90; min++) {
    if (Math.random() > 0.15) continue; // Roughly 10-15 key events in match
    
    const isUser = Math.random() < uWinProb;
    const actionRand = Math.random();

    if (actionRand < 0.28) {
      // Goal
      if (isUser) {
        uGoals++; uShots++; uSot++;
        const scorer = pickPlayer(userStarters, 'scorer');
        let assister = pickPlayer(userStarters, 'assister');
        if (assister.name === scorer.name) {
          assister = userStarters.find(p => p.name !== scorer.name) || assister;
        }
        
        const goalDescs = [
          `⚽ GOAL! ${scorer.name} fires a clinical shot past ${aiGK.name}! Assisted by ${assister.name}.`,
          `⚽ GOAL! A superb cross by ${assister.name} finds ${scorer.name} who headers it in!`,
          `⚽ GOAL! ${scorer.name} curls a beautiful free-kick over the wall and into the top corner!`
        ];
        events.push({
          min, type: 'GOAL', team: 'user',
          desc: goalDescs[Math.floor(Math.random() * goalDescs.length)],
          score: `${uGoals}-${aGoals}`,
          stats: { uShots, aShots, uSot, aSot, uFouls, aFouls, uYellows, aYellows }
        });
      } else {
        aGoals++; aShots++; aSot++;
        const scorer = pickPlayer(aiStarters, 'scorer');
        let assister = pickPlayer(aiStarters, 'assister');
        if (assister.name === scorer.name) {
          assister = aiStarters.find(p => p.name !== scorer.name) || assister;
        }

        const goalDescs = [
          `⚽ GOAL! ${scorer.name} beats the defender and slots it past ${userGK.name}! Assisted by ${assister.name}.`,
          `⚽ GOAL! ${scorer.name} converts from close range after a rebound! Assisted by ${assister.name}.`,
          `⚽ GOAL! ${scorer.name} scores a brilliant solo effort on a fast counter-attack!`
        ];
        events.push({
          min, type: 'GOAL', team: 'ai',
          desc: goalDescs[Math.floor(Math.random() * goalDescs.length)],
          score: `${uGoals}-${aGoals}`,
          stats: { uShots, aShots, uSot, aSot, uFouls, aFouls, uYellows, aYellows }
        });
      }
    } else if (actionRand < 0.60) {
      // Save
      if (isUser) {
        uShots++; uSot++;
        const attacker = pickPlayer(userStarters, 'scorer');
        const saveDescs = [
          `🧤 Great save! ${aiGK.name} tips ${attacker.name}'s long-range volley over the bar!`,
          `🧤 Saved! ${aiGK.name} blocks a low shot from ${attacker.name} inside the box.`
        ];
        events.push({
          min, type: 'SAVE', team: 'ai',
          desc: saveDescs[Math.floor(Math.random() * saveDescs.length)],
          score: `${uGoals}-${aGoals}`,
          stats: { uShots, aShots, uSot, aSot, uFouls, aFouls, uYellows, aYellows }
        });
      } else {
        aShots++; aSot++;
        const attacker = pickPlayer(aiStarters, 'scorer');
        const saveDescs = [
          `🧤 Superb save! ${userGK.name} stretches to deny a header from ${attacker.name}!`,
          `🧤 Saved! ${userGK.name} comfortably catches ${attacker.name}'s curl shot.`
        ];
        events.push({
          min, type: 'SAVE', team: 'user',
          desc: saveDescs[Math.floor(Math.random() * saveDescs.length)],
          score: `${uGoals}-${aGoals}`,
          stats: { uShots, aShots, uSot, aSot, uFouls, aFouls, uYellows, aYellows }
        });
      }
    } else if (actionRand < 0.82) {
      // Near miss
      if (isUser) {
        uShots++;
        const attacker = pickPlayer(userStarters, 'scorer');
        const missDescs = [
          `❌ Close! ${attacker.name} shoots from outside the box but it goes inches wide.`,
          `❌ Chance! ${attacker.name} gets on the end of a cross but headers it over the crossbar.`
        ];
        events.push({
          min, type: 'SAVE', team: 'user', // generic event
          desc: missDescs[Math.floor(Math.random() * missDescs.length)],
          score: `${uGoals}-${aGoals}`,
          stats: { uShots, aShots, uSot, aSot, uFouls, aFouls, uYellows, aYellows }
        });
      } else {
        aShots++;
        const attacker = pickPlayer(aiStarters, 'scorer');
        const missDescs = [
          `❌ Narrow miss! ${attacker.name}'s shot curls just wide of the post.`,
          `❌ Off target! ${attacker.name} volleys it high and wide.`
        ];
        events.push({
          min, type: 'SAVE', team: 'ai',
          desc: missDescs[Math.floor(Math.random() * missDescs.length)],
          score: `${uGoals}-${aGoals}`,
          stats: { uShots, aShots, uSot, aSot, uFouls, aFouls, uYellows, aYellows }
        });
      }
    } else {
      // Foul / Booking
      if (isUser) {
        uFouls++;
        const culprit = pickPlayer(userStarters, 'card');
        const isYellow = Math.random() < 0.4;
        if (isYellow) {
          uYellows++;
          events.push({
            min, type: 'CARD', team: 'user',
            desc: `🟨 Yellow Card: ${culprit.name} is booked for a late sliding tackle.`,
            score: `${uGoals}-${aGoals}`,
            stats: { uShots, aShots, uSot, aSot, uFouls, aFouls, uYellows, aYellows }
          });
        } else {
          events.push({
            min, type: 'SAVE', team: 'user',
            desc: `⚠️ Foul: ${culprit.name} intercepts roughly. Free kick awarded.`,
            score: `${uGoals}-${aGoals}`,
            stats: { uShots, aShots, uSot, aSot, uFouls, aFouls, uYellows, aYellows }
          });
        }
      } else {
        aFouls++;
        const culprit = pickPlayer(aiStarters, 'card');
        const isYellow = Math.random() < 0.4;
        if (isYellow) {
          aYellows++;
          events.push({
            min, type: 'CARD', team: 'ai',
            desc: `🟨 Yellow Card: ${culprit.name} receives a card after a rough foul.`,
            score: `${uGoals}-${aGoals}`,
            stats: { uShots, aShots, uSot, aSot, uFouls, aFouls, uYellows, aYellows }
          });
        } else {
          events.push({
            min, type: 'SAVE', team: 'ai',
            desc: `⚠️ Foul: ${culprit.name} commits a foul in the midfield.`,
            score: `${uGoals}-${aGoals}`,
            stats: { uShots, aShots, uSot, aSot, uFouls, aFouls, uYellows, aYellows }
          });
        }
      }
    }
  }

  events.push({
    min: 90, type: 'FT', team: 'both',
    desc: `🏁 Full Time! The referee blows the whistle. Final Score: User Dream Team ${uGoals} - ${aGoals} AI Elite Manager.`,
    score: `${uGoals}-${aGoals}`,
    stats: { uShots, aShots, uSot, aSot, uFouls, aFouls, uYellows, aYellows }
  });

  res.json({
    userGoals: uGoals,
    aiGoals: aGoals,
    userPower: uPow.toFixed(2),
    aiPower: aiPow.toFixed(2),
    userPos: uPos,
    aiPos: aiPos,
    events
  });
});

// 11. Match Details Center (New Endpoint)
app.get('/api/match/:id', async (req, res) => {
  const matchId = req.params.id;
  const simTime = req.query.simulated_time || new Date().toISOString();
  const { fixtures } = getTournamentState(simTime);

  const match = fixtures.find(f => f.id === matchId);
  if (!match) return res.status(404).json({ error: 'Match not found' });

  // Generate stats dynamically
  const stats = getMatchStats(match.id, match.home, match.away, match.home_score, match.away_score);
  
  const hAnalytics = ANALYTICS[match.home] || {};
  const aAnalytics = ANALYTICS[match.away] || {};

  const key = nextKey();
  let aiAnalysis = `A tactical battle between ${match.home} and ${match.away}. Expect a highly competitive match!`;

  if (key) {
    try {
      const isUpcoming = match.status === 'upcoming';
      const groundingContext = retrieveContext(`${match.home} ${match.away}`, simTime);
      const prompt = isUpcoming ? `You are a world-class football pundit and tactical analyst.
Match: ${match.home} vs ${match.away} (Upcoming Match)
- ${match.home} (FIFA Overall: ${hAnalytics.overall_rating}/10, Offense: ${hAnalytics.offense}/100, Defense: ${hAnalytics.defense}/100, Passing: ${hAnalytics.passing}%, Creativity: ${hAnalytics.creativity}/100)
- ${match.away} (FIFA Overall: ${aAnalytics.overall_rating}/10, Offense: ${aAnalytics.offense}/100, Defense: ${aAnalytics.defense}/100, Passing: ${aAnalytics.passing}%, Creativity: ${aAnalytics.creativity}/100)

${groundingContext}

CRITICAL GROUNDING INSTRUCTIONS:
Answer the query ONLY using the provided retrieved grounding context and team ratings.
If the required information is not available in the grounding context, say exactly:
"Data not available in current knowledge base."
Do not infer match results. Do not fabricate statistics.

Provide a premium match preview under 120 words.
Structure clearly with bold headers:
**Players to Watch**: Key players that will impact the game.
**Tactical Expectations**: How will the game flow?
**Predicted Score**: Specific scoreline prediction and why.` : `You are a world-class football pundit and tactical analyst.
Match: ${match.home} vs ${match.away}
- ${match.home} (FIFA Overall: ${hAnalytics.overall_rating}/10, Offense: ${hAnalytics.offense}/100, Defense: ${hAnalytics.defense}/100, Passing: ${hAnalytics.passing}%, Creativity: ${hAnalytics.creativity}/100)
- ${match.away} (FIFA Overall: ${aAnalytics.overall_rating}/10, Offense: ${aAnalytics.offense}/100, Defense: ${aAnalytics.defense}/100, Passing: ${aAnalytics.passing}%, Creativity: ${aAnalytics.creativity}/100)

${groundingContext}

CRITICAL GROUNDING INSTRUCTIONS:
Answer the query ONLY using the provided retrieved grounding context and team ratings.
If the required information is not available in the grounding context, say exactly:
"Data not available in current knowledge base."
Do not infer match results. Do not fabricate statistics.

Provide a premium H2H tactical overview under 120 words.
Structure clearly with bold headers:
**H2H Playstyles**: Compare their main styles.
**Key Factor**: Mention the deciding factor (e.g. low block counter vs high press).
**Verdict**: Predict a specific scoreline and state why.`;

      const r = await axios.post('https://api.groq.com/openai/v1/chat/completions',
        {
          model: 'llama-3.3-70b-versatile',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 250,
          temperature: 0.7
        },
        { headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, timeout: 3500 }
      );
      aiAnalysis = r.data.choices[0].message.content.trim();
    } catch (err) {
      console.error('Match H2H Groq error:', err.message);
    }
  }

  res.json({ match, stats, ai_analysis: aiAnalysis, home_analytics: hAnalytics, away_analytics: aAnalytics });
});

// 12. AI Live Commentary (New Endpoint)
app.post('/api/ai/live-commentary', async (req, res) => {
  const { matchId, home, away, score, scorers, minute, stats } = req.body;
  if (!matchId) return res.status(400).json({ error: 'matchId is required' });

  const key = nextKey();
  if (!key) return res.status(500).json({ error: 'No Groq API keys available' });

  const prompt = `You are a live football commentator reporting on a FIFA World Cup 2026 match (hosted in USA, Canada, and Mexico). DO NOT reference the 2022 World Cup or past events. Act as if it is the year 2026.
Match: ${home} vs ${away}
Current Minute: ${minute}'
Current Score: ${home} ${score} ${away}
Scorers: ${scorers && scorers.length ? scorers.map(s => `${s.name} (${s.min}')`).join(', ') : 'None'}
Stats: Possession ${stats?.possession?.home}% - ${stats?.possession?.away}%, Shots ${stats?.shots?.home} - ${stats?.shots?.away}

Write a short, engaging, 1-2 sentence live commentary event for the current minute (${minute}') of this match.
It should feel like a real-time text commentary update (e.g. BBC Sport or Sky Sports live text).
Be dramatic, describe a specific action (e.g., a near miss, a foul, a goal, a key pass), and mention player names from the scorers list or realistic generic descriptions.
Keep it strictly to 1 or 2 sentences max. Do not output anything other than the commentary text.`;

  try {
    const r = await axios.post('https://api.groq.com/openai/v1/chat/completions',
      { model: 'llama-3.3-70b-versatile', messages: [{ role: 'user', content: prompt }], max_tokens: 150, temperature: 0.8 },
      { headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' } }
    );
    res.json({ commentary: r.data.choices[0].message.content.trim() });
  } catch (e) {
    console.error('Groq live-commentary error:', e.response?.data || e.message);
    res.json({ commentary: `Action heating up in the midfield as both teams fight for possession in the ${minute}' minute!` });
  }
});

// 12b. AI Assistant Chatbot (New Endpoint)
app.post('/api/ai/chat', async (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'message is required' });

  const key = nextKey();
  if (!key) return res.status(500).json({ error: 'No Groq API keys available' });

  const simTime = req.body.simulated_time || req.query.simulated_time || new Date().toISOString();
  const groundingContext = retrieveContext(message, simTime);

  // Generate a context of overall ratings for all teams for Llama 3
  const contextList = Object.entries(ANALYTICS).map(([team, data]) => {
    return `${team} (Rating: ${data.overall_rating}/10, Group: ${data.group}, Top Player: ${data.top_player})`;
  }).join(', ');

const systemMessage = `You are a world-class football analyst, tactician, and prediction expert covering the FIFA World Cup 2026, which is hosted across the USA, Canada, and Mexico.
CRITICAL: You are operating in the year 2026. Do NOT reference results, rosters, or events from the 2022 World Cup in Qatar as if they are current. Focus solely on the projected 2026 landscape.

Here is the context of all 48 participating teams, their overall ratings, groups, and top players:
${contextList}

Key Tactical Insights & Facts:
- Major Favorites (Overall 8.5+): Portugal (POR), France (FRA), Spain (ESP), Argentina (ARG), Germany (GER), and England (ENG). They boast elite squad depth, tactical flexibility, and superstars (Kylian Mbappé, Rodri, Lamine Yamal, Cristiano Ronaldo, Jamal Musiala, Jude Bellingham).
- Dark Horses (Overall 7.2 - 8.2): Morocco (defensive transition speed), Uruguay (relentless high pressing under Bielsa), Croatia (midfield control), USA (young, athletic wingers), Senegal (physical strength).
- Underdogs (Overall 5.0 - 6.8): Uzbekistan (UZB), Qatar (QAT), Haiti (HAI), South Africa (RSA). Specifically, Uzbekistan is renowned for its incredible defensive discipline, running a tight 5-4-1 low block and using quick direct counter-attacks, making them a very stubborn and dangerous opponent despite their low overall rating.
- Official Matchball (FIFA 2026 Golden Glory): Uses a aerodynamic textured surface for stable drag, high speed spin stability, and true flight paths. It speeds up passing plays.

${groundingContext}

CRITICAL GROUNDING INSTRUCTIONS:
Answer the user query ONLY using the provided retrieved grounding context and team list.
If the requested information is not available in the grounding context, say exactly:
"Data not available in current knowledge base."
Do not infer match results. Do not fabricate statistics or details that are not in the context.

Provide precise, analytical answers. Write in the style of a premium Sky Sports football pundit. Make your response highly detailed yet engaging and professional. Limit your response to 150-220 words.`;

  try {
    const r = await axios.post('https://api.groq.com/openai/v1/chat/completions',
      {
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: systemMessage },
          { role: 'user', content: message }
        ],
        max_tokens: 300,
        temperature: 0.7
      },
      { headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' } }
    );
    res.json({ response: r.data.choices[0].message.content.trim() });
  } catch (e) {
    console.error('Groq chat error:', e.response?.data || e.message);
    res.json({ response: "I'm analyzing the tactical transitions on the pitch right now, but it looks like my feed is temporarily lagging. Portugal, Spain, and France are still heavy favorites due to their squad depth!" });
  }
});

// 12.5 AI-powered Live Match Stats
app.get('/api/live-stats-ai/:matchId', async (req, res) => {
  const matchId = req.params.matchId;
  const simTime = req.query.simulated_time || new Date().toISOString();
  const { fixtures } = getTournamentState(simTime);
  const match = fixtures.find(f => f.id === matchId);
  
  if (!match) return res.status(404).json({ error: 'Match not found' });
  
  // Get deterministic numerical stats
  const stats = getMatchStats(matchId, match.home, match.away, match.home_score, match.away_score);
  
  // Build prompt for LLM
  const key = nextKey();
  if (!key) {
    return res.json({ stats, narrative: "AI offline.", commentary: ["Match is underway."] });
  }

  const groundingContext = retrieveContext(`${match.home} ${match.away}`, simTime);
  const prompt = `You are a real-time football data API. Generate a JSON response for the match ${match.home} vs ${match.away} in the FIFA World Cup 2026 (Hosted in USA/Canada/Mexico). DO NOT mention the 2022 World Cup. Operate strictly in the year 2026.
Current status: ${match.status} (Minute: ${match.minute || 'FT'}). Score: ${match.home} ${match.home_score} - ${match.away_score} ${match.away}.
Stats: Possession ${stats.possession.home}%-${stats.possession.away}%, Shots ${stats.shots.home}-${stats.shots.away}.

${groundingContext}

CRITICAL GROUNDING INSTRUCTIONS:
Describe key actions using the provided retrieved grounding context and stats.
If key information is not in the context, do not fabricate statistics.

Respond EXACTLY in this JSON format, nothing else:
{
  "narrative": "A 2-sentence tactical summary of the match flow so far.",
  "commentary": [
    "Minute' - Action description (e.g. 73' - De Bruyne threads a perfect pass...)"
  ]
}
Include exactly 3 recent commentary events.`;

  try {
    const r = await axios.post('https://api.groq.com/openai/v1/chat/completions',
      {
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 300,
        temperature: 0.7,
        response_format: { type: "json_object" }
      },
      { headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' } }
    );
    
    let aiData;
    try {
      aiData = JSON.parse(r.data.choices[0].message.content);
    } catch(e) {
      aiData = { narrative: "A closely fought tactical battle.", commentary: ["Match ongoing..."] };
    }
    
    res.json({ match, stats, ...aiData });
  } catch (e) {
    console.error('Groq live-stats error:', e.message);
    res.json({ match, stats, narrative: "A highly intense match.", commentary: ["Waiting for live feed..."] });
  }
});

// 13. Sofascore proxy live scores (Fallback preserved)
app.get('/api/live', async (req, res) => {
  const key = process.env.rapidapi;
  if (key) {
    try {
      const r = await axios.get('https://sofascore.p.rapidapi.com/matches/get-live-events',
        { headers: { 'x-rapidapi-host': 'sofascore.p.rapidapi.com', 'x-rapidapi-key': key },
          params: { sport: 'football' }, timeout: 4000 });
      return res.json({ source: 'sofascore', events: r.data.events || [] });
    } catch {}
  }
  const simTime = req.query.simulated_time || new Date().toISOString();
  const { fixtures } = getTournamentState(simTime);
  const todayMatches = fixtures.filter(f => f.date === simTime.split('T')[0]);
  res.json({ source: 'dataset', events: todayMatches.map(f => ({
    id: f.id, status: f.status === 'finished' ? 'finished' : f.status === 'live' ? 'inprogress' : 'scheduled',
    home: { name: f.home, flag: ANALYTICS[f.home]?.flag },
    away: { name: f.away, flag: ANALYTICS[f.away]?.flag },
    score: { home: f.home_score, away: f.away_score },
    stage: f.stage, stadium: f.stadium, city: f.city,
    scorers: f.scorers, minute: f.minute
  })) });
});

// 14. Player compare
app.get('/api/compare', async (req, res) => {
  const { p1, p2 } = req.query;
  const player1 = findSquadPlayer(p1);
  const player2 = findSquadPlayer(p2);
  if (!player1 || !player2) return res.status(404).json({ error: 'One or both players not found' });

  const key = nextKey();
  let aiComparison = "";
  if (key) {
    const prompt = `You are a world-class football tactical analyst. Compare these two players for the FIFA World Cup 2026:
Player 1: ${player1.name} (Team: ${player1.team}, Pos: ${player1.position}, Age: ${player1.age}, Club: ${player1.club}, Rating: ${player1.rating}, Goals: ${player1.goals}, Assists: ${player1.assists})
Player 2: ${player2.name} (Team: ${player2.team}, Pos: ${player2.position}, Age: ${player2.age}, Club: ${player2.club}, Rating: ${player2.rating}, Goals: ${player2.goals}, Assists: ${player2.assists})

Provide a concise, 100-word tactical comparison of their roles, strengths, and who would be more critical in a tournament setting. Be specific, analytical, and sound like a Sky Sports pundit.`;
    try {
      const r = await axios.post('https://api.groq.com/openai/v1/chat/completions',
        { model: 'llama-3.3-70b-versatile', messages: [{ role: 'user', content: prompt }], max_tokens: 200, temperature: 0.7 },
        { headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, timeout: 3500 }
      );
      aiComparison = r.data.choices[0].message.content.trim();
    } catch (e) {
      console.error('Groq compare error:', e.message);
      aiComparison = "Tactical comparison currently unavailable due to API rate limiting.";
    }
  } else {
    aiComparison = "Groq key not configured for AI comparison.";
  }

  res.json({ player1, player2, ai_comparison: aiComparison });
});

// 15. Real Live Football Feed proxy (API-Football)
let realLiveCache = {
  dateStr: '',
  fetchedAt: 0,
  data: null
};

const getTodayISTString = () => {
  const d = new Date(new Date().getTime() + (5.5 * 60 * 60 * 1000));
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

function getDemoRealMatches() {
  return [
    {
      id: 1, league: 'European Championship', country: 'Europe',
      logo: 'https://media.api-sports.io/football/leagues/4.png',
      home: 'Germany', home_logo: 'https://media.api-sports.io/football/teams/25.png',
      away: 'Scotland', away_logo: 'https://media.api-sports.io/football/teams/32.png',
      score: { home: 5, away: 1 }, status: 'FT', time: 90,
      kickoff: new Date().toISOString()
    },
    {
      id: 2, league: 'Copa America', country: 'South America',
      logo: 'https://media.api-sports.io/football/leagues/9.png',
      home: 'Argentina', home_logo: 'https://media.api-sports.io/football/teams/26.png',
      away: 'Canada', away_logo: 'https://media.api-sports.io/football/teams/30.png',
      score: { home: 2, away: 0 }, status: 'FT', time: 90,
      kickoff: new Date().toISOString()
    },
    {
      id: 3, league: 'European Championship', country: 'Europe',
      logo: 'https://media.api-sports.io/football/leagues/4.png',
      home: 'Spain', home_logo: 'https://media.api-sports.io/football/teams/9.png',
      away: 'Croatia', away_logo: 'https://media.api-sports.io/football/teams/3.png',
      score: { home: 3, away: 0 }, status: 'FT', time: 90,
      kickoff: new Date().toISOString()
    },
    {
      id: 4, league: 'Major League Soccer', country: 'USA',
      logo: 'https://media.api-sports.io/football/leagues/253.png',
      home: 'Inter Miami', home_logo: 'https://media.api-sports.io/football/teams/1605.png',
      away: 'Columbus Crew', away_logo: 'https://media.api-sports.io/football/teams/1612.png',
      score: { home: 2, away: 1 }, status: 'FT', time: 90,
      kickoff: new Date().toISOString()
    }
  ];
}

app.get('/api/real-live', async (req, res) => {
  const key = process.env.fapi;
  const todayStr = getTodayISTString();
  const now = Date.now();

  // If cache is valid (fetched today, and is less than 1 hour old)
  if (realLiveCache.data && realLiveCache.dateStr === todayStr && (now - realLiveCache.fetchedAt < 60 * 60 * 1000)) {
    return res.json({ source: 'cache', refreshedAt: new Date(realLiveCache.fetchedAt).toISOString(), fixtures: realLiveCache.data });
  }

  if (!key || key.trim() === '' || key === 'a16312a1b9f2d53f5a3979a527f0f3d7') {
    // Return fallback demo data if fapi key is not configured or is a placeholder
    const demoMatches = getDemoRealMatches();
    return res.json({ source: 'demo', refreshedAt: new Date().toISOString(), fixtures: demoMatches });
  }

  try {
    const response = await axios.get('https://v3.football.api-sports.io/fixtures', {
      headers: {
        'x-apisports-key': key
      },
      params: {
        date: todayStr
      },
      timeout: 5000
    });

    const list = response.data?.response || [];
    if (list.length > 0) {
      const formatted = list.map(item => ({
        id: item.fixture.id,
        league: item.league.name,
        country: item.league.country,
        logo: item.league.logo,
        home: item.teams.home.name,
        home_logo: item.teams.home.logo,
        away: item.teams.away.name,
        away_logo: item.teams.away.logo,
        score: {
          home: item.goals.home !== null ? item.goals.home : 0,
          away: item.goals.away !== null ? item.goals.away : 0
        },
        status: item.fixture.status.short,
        time: item.fixture.status.elapsed || 0,
        kickoff: item.fixture.date
      }));

      // Update cache
      realLiveCache = {
        dateStr: todayStr,
        fetchedAt: now,
        data: formatted
      };

      return res.json({ source: 'api', refreshedAt: new Date(now).toISOString(), fixtures: formatted });
    } else {
      const demoMatches = getDemoRealMatches();
      return res.json({ source: 'demo_empty', refreshedAt: new Date().toISOString(), fixtures: demoMatches });
    }
  } catch (err) {
    console.error('API-Football error:', err.message);
    const demoMatches = getDemoRealMatches();
    return res.json({ source: 'demo_fallback', refreshedAt: new Date().toISOString(), fixtures: demoMatches });
  }
});
// 15. Predictor Simulation
app.get('/api/predictor', (req, res) => {
  const r32 = [
    { id: 'R32-1', home: 'Argentina', away: 'Scotland', homeScore: 2, awayScore: 0 },
    { id: 'R32-2', home: 'France', away: 'Algeria', homeScore: 3, awayScore: 1 },
    { id: 'R32-3', home: 'Spain', away: 'Senegal', homeScore: 1, awayScore: 0 },
    { id: 'R32-4', home: 'Brazil', away: 'Norway', homeScore: 2, awayScore: 1 },
    { id: 'R32-5', home: 'Germany', away: 'Panama', homeScore: 4, awayScore: 0 },
    { id: 'R32-6', home: 'Portugal', away: 'Ghana', homeScore: 2, awayScore: 0 },
    { id: 'R32-7', home: 'England', away: 'Uzbekistan', homeScore: 1, awayScore: 0 },
    { id: 'R32-8', home: 'Netherlands', away: 'Costa Rica', homeScore: 2, awayScore: 0 },
    { id: 'R32-9', home: 'USA', away: 'Ecuador', homeScore: 1, awayScore: 1, pen: '4-3' },
    { id: 'R32-10', home: 'Mexico', away: 'Sweden', homeScore: 0, awayScore: 1 },
    { id: 'R32-11', home: 'Colombia', away: 'Morocco', homeScore: 1, awayScore: 2 },
    { id: 'R32-12', home: 'Uruguay', away: 'Nigeria', homeScore: 2, awayScore: 0 },
    { id: 'R32-13', home: 'Italy', away: 'Japan', homeScore: 1, awayScore: 0 },
    { id: 'R32-14', home: 'Croatia', away: 'Canada', homeScore: 2, awayScore: 1 },
    { id: 'R32-15', home: 'Belgium', away: 'South Korea', homeScore: 3, awayScore: 0 },
    { id: 'R32-16', home: 'Denmark', away: 'Switzerland', homeScore: 0, awayScore: 0, pen: '3-4' }
  ];
  
  const r16 = [
    { id: 'R16-1', home: 'Argentina', away: 'France', homeScore: 1, awayScore: 2 },
    { id: 'R16-2', home: 'Spain', away: 'Brazil', homeScore: 2, awayScore: 1 },
    { id: 'R16-3', home: 'Germany', away: 'Portugal', homeScore: 1, awayScore: 1, pen: '3-4' },
    { id: 'R16-4', home: 'England', away: 'Netherlands', homeScore: 2, awayScore: 0 },
    { id: 'R16-5', home: 'USA', away: 'Sweden', homeScore: 0, awayScore: 2 },
    { id: 'R16-6', home: 'Morocco', away: 'Uruguay', homeScore: 1, awayScore: 0 },
    { id: 'R16-7', home: 'Italy', away: 'Croatia', homeScore: 0, awayScore: 0, pen: '5-4' },
    { id: 'R16-8', home: 'Belgium', away: 'Switzerland', homeScore: 2, awayScore: 1 }
  ];
  
  const qf = [
    { id: 'QF-1', home: 'France', away: 'Spain', homeScore: 0, awayScore: 1 },
    { id: 'QF-2', home: 'Portugal', away: 'England', homeScore: 2, awayScore: 1 },
    { id: 'QF-3', home: 'Sweden', away: 'Morocco', homeScore: 1, awayScore: 2 },
    { id: 'QF-4', home: 'Italy', away: 'Belgium', homeScore: 1, awayScore: 0 }
  ];
  
  const sf = [
    { id: 'SF-1', home: 'Spain', away: 'Portugal', homeScore: 2, awayScore: 2, pen: '5-4' },
    { id: 'SF-2', home: 'Morocco', away: 'Italy', homeScore: 0, awayScore: 1 }
  ];
  
  const final = {
    home: 'Spain', away: 'Italy', homeScore: 2, awayScore: 0, winner: 'Spain'
  };

  res.json({ r32, r16, qf, sf, final });
});

// Webhook endpoint to accept real-time match events
app.post('/api/webhook/match-update', (req, res) => {
  const payload = req.body;
  console.log('Received match update webhook:', payload);
  
  if (payload && (payload.matchId || payload.id)) {
    // Broadcast webhook event to all active WebSockets connections
    io.emit('match-update', {
      event: payload.event || 'goal',
      matchId: payload.matchId || payload.id,
      team: payload.team,
      scorer: payload.scorer || payload.player,
      min: payload.min || payload.minute,
      score: payload.score,
      cardType: payload.cardType,
      player: payload.player
    });
  }
  
  res.status(200).json({ success: true, message: 'Webhook received successfully' });
});

server.listen(PORT, () => console.log(`\n🏆 FIFA 2026 Dashboard running → http://localhost:${PORT}\n`));
