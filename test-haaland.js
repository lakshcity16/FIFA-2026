const http = require('http');

http.get('http://localhost:3050/api/auction/pool', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    const d = JSON.parse(data);
    const h = d.players.find(p=>p.name.toLowerCase().includes('haaland'));
    console.log(h ? `Found ${h.name} (${h.position}) - Total pool: ${d.total}` : `Not found. Total pool: ${d.total}`);
  });
});
