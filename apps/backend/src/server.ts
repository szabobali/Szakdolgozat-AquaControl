import express from 'express';
import cors from 'cors';
import { connect } from 'mqtt';

const app = express();
app.use(cors());
app.use(express.json());

const mqttClient = connect('mqtt://localhost:1883');
let sseClients: any[] = [];

// GET /api/zones - A kezdeti adatok betöltéséhez
app.get('/api/zones', (req, res) => {
  console.log('[Backend] Zónák lekérése...');
  res.json([{ id: 1, name: 'Zóna 1', state: 'OFF' }]);
});

// POST /api/command - A parancs fogadása
app.post('/api/command', (req, res) => {
  const { zoneId, action } = req.body;
  console.log(`[Backend] POST kérés érkezett: Zóna ${zoneId}, Akció: ${action}`);
  
  const topic = `garden/valves/${zoneId}/command`;
  const payload = JSON.stringify({ state: action === 'START' ? 'ON' : 'OFF', duration_seconds: 900 });
  
  mqttClient.publish(topic, payload);
  res.status(200).json({ success: true });
});

// SSE endpoint
app.get('/api/stream/system-status', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  
  sseClients.push(res);
  console.log(`[Backend] SSE kliens csatlakozott. Aktív kliensek: ${sseClients.length}`);

  req.on('close', () => {
    sseClients = sseClients.filter(c => c !== res);
  });
});

// MQTT üzenetek továbbítása SSE-n
mqttClient.on('message', (topic, message) => {
  console.log(`📩 [Backend] MQTT üzenet érkezett: ${topic} -> ${message.toString()}`);
  const data = JSON.parse(message.toString());
  sseClients.forEach(client => client.write(`data: ${JSON.stringify(data)}\n\n`));
});

app.listen(3000, () => console.log('Backend fut a 3000-es porton.'));