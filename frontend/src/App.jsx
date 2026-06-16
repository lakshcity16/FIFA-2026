import { useState, useEffect } from 'react'
import './App.css'
import PredictorTab from './PredictorTab'

function App() {
  const [activeTab, setActiveTab] = useState('overview');
  const [teams, setTeams] = useState([]);
  const [liveMatches, setLiveMatches] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [chatResponse, setChatResponse] = useState('');

  const API_URL = "http://localhost:8000/api";

  useEffect(() => {
    fetch(`${API_URL}/teams`)
      .then(res => res.json())
      .then(data => setTeams(data.teams || []));
      
    fetch(`${API_URL}/live`)
      .then(res => res.json())
      .then(data => setLiveMatches(data.fixtures || []));
  }, []);

  const handleChat = async () => {
    if (!chatInput.trim()) return;
    setChatResponse("Analyzing data...");
    try {
      const res = await fetch(`${API_URL}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: chatInput })
      });
      const data = await res.json();
      setChatResponse(data.response);
    } catch(e) {
      setChatResponse("Error reaching Groq AI.");
    }
  };

  return (
    <div className="app-container">
      <header className="header">
        <h1>Mini Sofascore: WC 2026 Live</h1>
        <nav>
          <button onClick={() => setActiveTab('overview')} className={activeTab === 'overview' ? 'active' : ''}>Live Center</button>
          <button onClick={() => setActiveTab('groups')} className={activeTab === 'groups' ? 'active' : ''}>Groups</button>
          <button onClick={() => setActiveTab('auction')} className={activeTab === 'auction' ? 'active' : ''}>Auction Draft</button>
          <button onClick={() => setActiveTab('predictor')} className={activeTab === 'predictor' ? 'active' : ''}>Predictor</button>
        </nav>
      </header>

      <main className="content">
        {activeTab === 'overview' && (
          <div className="overview-tab">
            <div className="live-matches">
              <h2>🔴 Live Matches</h2>
              {liveMatches.length === 0 ? <p>No live matches currently.</p> : (
                <div className="match-list">
                  {liveMatches.map(m => (
                    <div key={m.id} className="match-card">
                      <div className="match-status">{m.time}'</div>
                      <div className="match-teams">
                        <span>{m.home}</span>
                        <span className="score">{m.score.home} - {m.score.away}</span>
                        <span>{m.away}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="ai-analyst">
              <h2>🤖 Groq AI Analyst</h2>
              <div className="chat-box">
                <textarea 
                  value={chatInput} 
                  onChange={e => setChatInput(e.target.value)} 
                  placeholder="Ask about xG, momentum, or tactical shifts..."
                ></textarea>
                <button onClick={handleChat}>Ask Analyst</button>
                {chatResponse && (
                  <div className="chat-response">
                    <strong>Analyst:</strong> {chatResponse}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'predictor' && <PredictorTab apiUrl={API_URL} />}

        {/* Other tabs will be implemented as separate components */}
        {activeTab !== 'overview' && activeTab !== 'predictor' && (
          <div className="wip">
            <h2>{activeTab.toUpperCase()}</h2>
            <p>Component is under construction. Integrating with FastAPI...</p>
          </div>
        )}
      </main>
    </div>
  )
}

export default App
