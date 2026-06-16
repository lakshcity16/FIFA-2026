import { useState, useEffect } from 'react';

export default function PredictorTab({ apiUrl }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  const runPredictor = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${apiUrl}/predictor`);
      const d = await res.json();
      setData(d);
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  };

  if (!data && !loading) {
    return (
      <div style={{ textAlign: 'center', padding: '2rem' }}>
        <h2>Tournament Predictor</h2>
        <p>Simulate the entire knockout stage to the Final.</p>
        <button onClick={runPredictor} style={{ padding: '1rem 2rem', fontSize: '1.2rem', cursor: 'pointer', background: '#38bdf8', color: '#0f172a', border: 'none', borderRadius: '8px' }}>
          Simulate Knockouts
        </button>
      </div>
    );
  }

  if (loading) return <div style={{ textAlign: 'center' }}>Simulating billions of variables...</div>;

  const renderMatch = (m) => (
    <div key={m.id} style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '8px', padding: '10px', marginBottom: '10px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', color: m.homeScore > m.awayScore ? '#38bdf8' : '#94a3b8' }}>
        <span>{m.home}</span>
        <span>{m.homeScore}</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', color: m.awayScore > m.homeScore ? '#38bdf8' : '#94a3b8' }}>
        <span>{m.away}</span>
        <span>{m.awayScore}</span>
      </div>
      {m.pen && <div style={{ fontSize: '0.8rem', color: '#94a3b8', textAlign: 'center', marginTop: '4px' }}>Pen: {m.pen}</div>}
    </div>
  );

  return (
    <div>
      <h2 style={{ textAlign: 'center', color: '#38bdf8' }}>🏆 {data.final.winner} wins the World Cup!</h2>
      <div style={{ display: 'flex', gap: '2rem', marginTop: '2rem', overflowX: 'auto' }}>
        <div style={{ minWidth: '200px' }}>
          <h3>Round of 32</h3>
          {data.r32.map(renderMatch)}
        </div>
        <div style={{ minWidth: '200px' }}>
          <h3>Round of 16</h3>
          {data.r16.map(renderMatch)}
        </div>
        <div style={{ minWidth: '200px' }}>
          <h3>Quarter-Finals</h3>
          {data.qf.map(renderMatch)}
        </div>
        <div style={{ minWidth: '200px' }}>
          <h3>Semi-Finals</h3>
          {data.sf.map(renderMatch)}
        </div>
        <div style={{ minWidth: '200px' }}>
          <h3>Final</h3>
          <div style={{ background: '#1e293b', border: '2px solid #fbbf24', borderRadius: '8px', padding: '1rem', textAlign: 'center' }}>
            <h2 style={{ margin: 0, color: '#fbbf24' }}>{data.final.home} {data.final.homeScore}</h2>
            <h4 style={{ margin: '10px 0' }}>VS</h4>
            <h2 style={{ margin: 0, color: '#fbbf24' }}>{data.final.away} {data.final.awayScore}</h2>
          </div>
        </div>
      </div>
    </div>
  );
}
