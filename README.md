# 🏆 FIFA World Cup 2026 AI Simulator & Manager

An advanced, enterprise-grade AI simulation platform and match manager for the upcoming FIFA World Cup 2026. This project leverages LLM integration (Groq + LLaMA 3.1) and real-world player analytics to create an immersive, dynamic tournament experience.

🌐 **Live Demo (Render):** [https://fifa-2026-17jq.onrender.com/](https://fifa-2026-17jq.onrender.com/)

![Tournament Overview](https://i.imgur.com/your-screenshot-url.png) *<!-- Replace with actual screenshot -->*

## ✨ Key Features

- **🧠 Real-Time AI Match Pipeline**: Matches are simulated day-by-day using a background pipeline powered by Groq's `llama-3.1-8b-instant`. The LLM dynamically generates scorers, match events, possession stats, detailed narratives, and live commentary.
- **📈 ML Tournament Predictions**: Monte Carlo-inspired predictions for group stages and knockout brackets, giving win-probabilities based on team power metrics (offense, defense, possession, creativity).
- **🤖 Smart AI Draft & Auction**: Play as the manager of a nation. Features a complete interactive draft UI with an auction pool of **1,248 real players**. The opposing AI teams intelligently draft players based on specific tactical formations (e.g., 4-3-3, 4-2-3-1) ensuring balanced squads.
- **💬 Grounded AI Chat Assistant (RAG)**: A built-in AI assistant capable of answering complex football queries. It utilizes a custom **RAG (Retrieval-Augmented Generation)** system grounded in a master dataset of 620 international players and their historical metrics (Caps, Goals, xG, Minutes Played, etc.).
- **⏳ Time Machine Simulator**: Jump forward and backward in time! The tournament state (live matches, standings, top performers) dynamically reacts based on the selected simulated date.
- **📊 Live Standings & Top Performers**: Real-time aggregation of goals, assists, player ratings, and xG from the AI pipeline, displaying the tournament's best performers and live group points tables.

## 🛠️ Technology Stack

- **Backend**: Node.js, Express.js
- **Frontend**: Vanilla JS, HTML5, CSS3 (Modern Glassmorphism & Dashboard aesthetics)
- **AI Integration**: [Groq API](https://console.groq.com/) for lightning-fast inference (LLaMA-3 models)
- **Data Engine**: CSV parsing for RAG grounding, JSON for persistent fixture/analytics state.

## 🚀 Getting Started

### Prerequisites
- Node.js (v16+ recommended)
- A Groq API Key

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/lakshcity16/FIFA-2026.git
   cd FIFA-2026
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Configure Environment:**
   Create a `.env` file in the root directory and add your Groq API key:
   ```env
   GROQ_API_KEY=your_groq_api_key_here
   ```

4. **Run the application:**
   ```bash
   npm start
   ```
   *(For development with auto-reload, use `npm run dev` if configured with nodemon)*

5. **Open in Browser:**
   Navigate to `http://localhost:3000`

## 📂 Project Structure

- `index.js` - Main Express server, AI Pipeline logic, RAG implementation, and API endpoints.
- `public/` - Frontend assets (HTML, CSS, JS, Images, JSON data).
- `public/app.js` - Core frontend logic for UI rendering, tab navigation, and AI integrations.
- `data/` *(Root CSVs)* - `FIFA2026_Grounding_Master.csv`, `SquadLists.csv` used for RAG and Draft grounding.
- `.env` - Environment variables (ignored in Git).

## 💡 How the AI Works

1. **Match Simulation**: When a match date is reached via the Time Machine, the background pipeline prompts the LLM with the fixture details. The LLM returns structured JSON containing scores, scorers, and stats.
2. **AI Chat (RAG)**: User queries are matched against `FIFA2026_Grounding_Master.csv` using keyword and fuzzy-matching. The relevant context is injected into the prompt, grounding the LLM's responses in factual tournament data and player forms.

## 🚀 Future Enhancements

- **Multiplayer Draft Mode**: Allow friends to join the same lobby and draft against each other in real-time.
- **Dynamic Player Morale**: Player forms shift dynamically based on match events and team momentum.
- **Live Video Highlights Generation**: Integrating video generation APIs to showcase critical match moments.

## 📝 License

This project is licensed under the MIT License.

---
*Built with ❤️ for the love of Football and AI.*
