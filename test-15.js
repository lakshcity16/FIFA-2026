const http = require('http');

http.get('http://localhost:3050/api/fixtures?date=2026-06-15', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    const d = JSON.parse(data);
    d.fixtures.forEach(f => {
      console.log(`${f.id} | ${f.home} vs ${f.away} | is_played: ${f.is_played} | score: ${f.home_score}-${f.away_score} | status: ${f.status}`);
    });
  });
});
