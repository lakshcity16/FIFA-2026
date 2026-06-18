const http = require('http');

http.get('http://localhost:3050/api/fixtures?simulated_time=2026-06-30T23:59:00Z', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    const d = JSON.parse(data);
    const played = d.fixtures.filter(f => f.is_played);
    played.forEach(f => {
      console.log(`${f.id} | ${f.home} vs ${f.away} | Score: ${f.home_score}-${f.away_score} | Scorers: ${f.scorers ? f.scorers.length : 0} | Stats: ${!!f.stats}`);
      if (!f.stats || Object.keys(f.stats).length === 0) {
        console.log(`  -> MISSING STATS FOR ${f.id}`);
      }
      if (f.home_score + f.away_score > 0 && (!f.scorers || f.scorers.length === 0)) {
        console.log(`  -> MISSING SCORERS FOR ${f.id}`);
      }
    });
    console.log(`Total played matches: ${played.length}`);
  });
});
