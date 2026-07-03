import express from 'express';
import cors from 'cors';
import mqtt from 'mqtt';
import { PrismaClient } from '@prisma/client';

const app = express();
const prisma = new PrismaClient();

app.use(cors());
app.use(express.json());

// SSE (Server-Sent Events) kliensek memóriában tartása
let sseClients: { id: number, res: express.Response }[] = [];

// Csatlakozás a helyi Mosquitto brókerhez (Docker, natív RPi vagy localhost)
const mqttClient = mqtt.connect('mqtt://localhost:1883');

mqttClient.on('connect', () => {
  console.log('✅ MQTT Broker connected');
  // Feliratkozunk minden zóna státusz jelentésére
  mqttClient.subscribe('garden/valves/+/status');
});

// Eseménykezelő a hardverből beérkező válaszokra
mqttClient.on('message', async (topic, message) => {
  console.log(`📩 MQTT Message received on ${topic}: ${message.toString()}`);
  
  const topicParts = topic.split('/');
  const zoneIdentifier = topicParts[2]; // pl. "1" a "garden/valves/1/status" -ból
  const payload = JSON.parse(message.toString());

  // SSE értesítés a frontendnek a valós hardveres állapotról
  broadcastSystemStatusUpdate(Number(zoneIdentifier), payload.state === 'ON');

  // ITT LEHETNE: Frissíteni az SQL History-t IN_PROGRESS-ről COMPLETED-re
});

app.get('/api/stream/system-status', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });

  const clientId = Date.now();
  sseClients.push({ id: clientId, res });
  console.log(`📡 SSE Client connected: ${clientId}`);

  // Kezdeti üzenet a sikeres csatlakozásról
  res.write(`data: ${JSON.stringify({ type: 'CONNECTED', message: 'SSE Stream Ready' })}\n\n`);

  req.on('close', () => {
    console.log(`🔌 SSE Client disconnected: ${clientId}`);
    sseClients = sseClients.filter(client => client.id !== clientId);
  });
});

// Segédfüggvény az SSE kliensek értesítésére
function broadcastSystemStatusUpdate(zoneId: number, isActive: boolean) {
  const payload = JSON.stringify({ type: 'ZONE_STATUS_CHANGE', zoneId, isActive });
  sseClients.forEach(client => {
    client.res.write(`data: ${payload}\n\n`);
  });
}

app.post('/api/zones/:id/start', async (req, res) => {
  const zoneId = parseInt(req.params.id);
  const duration = req.body.duration || 15; // default 15 perc

  try {
    // 1. Zóna validáció
    const zone = await prisma.zone.findUnique({ where: { id: zoneId } });
    if (!zone) {
      return res.status(404).json({ error: "Zone not found" });
    }
    if (!zone.is_active) {
      return res.status(400).json({ error: "Zone is disabled in settings" });
    }

    // 2. Idempotencia: Ellenőrizzük, hogy NEM fut-e már a locsolás
    const activeHistory = await prisma.history.findFirst({
      where: {
        zone_id: zoneId,
        status: 'IN_PROGRESS'
      }
    });

    if (activeHistory) {
      return res.status(409).json({ error: "Watering is already in progress for this zone." });
    }

    // 3. Bejegyezzük az adatbázisba a szándékot
    await prisma.history.create({
      data: {
        zone_id: zoneId,
        trigger_source: 'MANUAL',
        status: 'IN_PROGRESS'
      }
    });

    // 4. Kiküldjük az MQTT parancsot a hardvernek
    const commandPayload = JSON.stringify({ state: 'ON', duration_seconds: duration * 60 });
    mqttClient.publish(zone.mqtt_topic_cmd, commandPayload);

    // 5. Válasz a Reactnek
    res.json({ message: "Command sent to hardware", zoneId });

  } catch (error) {
    console.error("Failed to start watering:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post('/api/zones/:id/stop', async (req, res) => {
  const zoneId = parseInt(req.params.id);
  
  try {
    const zone = await prisma.zone.findUnique({ where: { id: zoneId } });
    if (!zone) return res.status(404).json({ error: "Zone not found" });

    // MQTT Parancs kiküldése
    const commandPayload = JSON.stringify({ state: 'OFF' });
    mqttClient.publish(zone.mqtt_topic_cmd, commandPayload);
    
    res.json({ message: "Stop command sent", zoneId });
  } catch(error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Backend server is running on http://localhost:${PORT}`);
});