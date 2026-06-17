const http = require('http');

http.get('http://localhost:3050/api/fixtures', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    const d = JSON.parse(data);
    ['M017', 'M018', 'M019', 'M020', 'M021'].forEach(id => {
      const m = d.fixtures.find(f => f.id === id);
      console.log(`${id}: ${m.home} vs ${m.away} | Status: ${m.status} | Score: ${m.home_score}-${m.away_score} | is_played: ${m.is_played}`);
    });
  });
});
