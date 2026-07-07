import express from 'express';
import cors from 'cors';
import { connect } from 'mqtt';
import { PrismaClient } from '@prisma/client';

const app = express();
app.use(cors());
app.use(express.json());
let topicToZoneIdMap: Record<string, number> = {};
async function buildTopicCache() {
  const zones = await prisma.zone.findMany({
    select: { id: true, mqtt_topic_status: true }
  });
  
  topicToZoneIdMap = {};
  zones.forEach(z => {
    if (z.mqtt_topic_status) {
      topicToZoneIdMap[z.mqtt_topic_status] = z.id;
    }
  });
  console.log('[Backend] MQTT Topic Cache felépítve az I/O minimalizálása érdekében.');
}

// Prisma
const prisma = new PrismaClient();

// MQTT
const mqttClient = connect('mqtt://localhost:1883');
let sseClients: any[] = [];

// GET /api/zones - Zónák lekérése az adatbázisból
app.get('/api/zones', async (req, res) => {
  try {
    console.log('[Backend] DB: Zónák lekérése...');
    const zones = await prisma.zone.findMany();
    // Map to frontend shape
    const mapped = zones.map(z => ({
      id: z.id.toString(),
      name: z.name,
      isActive: z.is_active,
      duration: z.default_duration,
      mqttTopicCmd: z.mqtt_topic_cmd,
      mqttTopicStatus: z.mqtt_topic_status
    }));
    res.json(mapped);
  } catch (err) {
    console.error('[Backend] Hiba a zónák lekérésekor:', err);
    res.status(500).json([]);
  }
});

// POST /api/command - legacy / generic command endpoint (megtartva)
app.post('/api/command', (req, res) => {
  const { zoneId, action } = req.body;
  console.log(`[Backend] POST /api/command: Zóna ${zoneId}, Akció: ${action}`);
  const topic = `garden/valves/${zoneId}/command`;
  const payload = JSON.stringify({ state: action === 'START' ? 'ON' : 'OFF', duration_seconds: 900 });
  mqttClient.publish(topic, payload, (err) => {
    if (err) {
      console.error('[Backend] MQTT publish error (command):', err);
      return res.status(500).json({ success: false, error: err.message });
    }
    return res.status(200).json({ success: true });
  });
});

// POST /api/zones/:id/start - kézi indítás + history sor létrehozása
// POST /api/zones/:zoneId/start - Öntözés indítása, DB és History mentés, majd MQTT kiküldés
app.post('/api/zones/:zoneId/start', async (req, res) => {
  const zoneId = parseInt(req.params.zoneId, 10);
  const { duration } = req.body; // Időtartam percekben a frontendről

  if (isNaN(zoneId)) {
    return res.status(400).json({ error: 'Érvénytelen zóna azonosító' });
  }

  try {
    console.log(`[Backend] Öntözés indítása kérés érkezett - Zóna: ${zoneId}, Időtartam: ${duration} perc`);

    // 1. Lokális DB állapot frissítése (is_active = true)
    await prisma.zone.update({
      where: { id: zoneId },
      data: { is_active: true }
    });

    // 2. Új történeti rekord (History) beszúrása IN_PROGRESS státusszal
    await prisma.history.create({
      data: {
        zone_id: zoneId,
        start_time: new Date(),
        status: 'IN_PROGRESS',
        trigger_source: 'MANUAL'
      }
    });

    // 3. MQTT parancs kiküldése a hardver/szimulátor felé
    const zone = await prisma.zone.findUnique({ where: { id: zoneId } });
    const topic = zone?.mqtt_topic_cmd || `garden/valves/${zoneId}/command`;
    const payload = JSON.stringify({
      state: 'ON',
      duration_seconds: (duration || 15) * 60
    });

    mqttClient.publish(topic, payload, { qos: 1 });

    // 4. Azonnali SSE push a frontend klienseknek az optimista állapot-szinkronizációért
    const ssePayload = { type: 'ZONE_STATUS_CHANGE', zoneId, isActive: true };
    sseClients.forEach(client => client.write(`data: ${JSON.stringify(ssePayload)}\n\n`));

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error(`[Backend] Hiba az öntözés indításakor (Zóna: ${zoneId}):`, err);
    return res.status(500).json({ error: 'Belső szerverhiba az indítás során' });
  }
});

// POST /api/zones/:zoneId/stop - Öntözés leállítása, DB és History lezárás, majd MQTT kiküldés
app.post('/api/zones/:zoneId/stop', async (req, res) => {
  const zoneId = parseInt(req.params.zoneId, 10);

  if (isNaN(zoneId)) {
    return res.status(400).json({ error: 'Érvénytelen zóna azonosító' });
  }

  try {
    console.log(`[Backend] Öntözés leállítása kérés érkezett - Zóna: ${zoneId}`);

    // 1. Lokális DB állapot frissítése (is_active = false)
    await prisma.zone.update({
      where: { id: zoneId },
      data: { is_active: false }
    });

    // 2. Aktív, folyamatban lévő history rekord lezárása (end_time beállítása, státusz COMPLETED)
    const activeHistory = await prisma.history.findFirst({
      where: { zone_id: zoneId, status: 'IN_PROGRESS' },
      orderBy: { start_time: 'desc' }
    });

    if (activeHistory) {
      await prisma.history.update({
        where: { id: activeHistory.id },
        data: {
          end_time: new Date(),
          status: 'COMPLETED'
        }
      });
    }

    // 3. MQTT leállító parancs kiküldése
    const zone = await prisma.zone.findUnique({ where: { id: zoneId } });
    const topic = zone?.mqtt_topic_cmd || `garden/valves/${zoneId}/command`;
    const payload = JSON.stringify({ state: 'OFF' });

    mqttClient.publish(topic, payload, { qos: 1 });

    // 4. SSE értesítés a leállításról
    const ssePayload = { type: 'ZONE_STATUS_CHANGE', zoneId, isActive: false };
    sseClients.forEach(client => client.write(`data: ${JSON.stringify(ssePayload)}\n\n`));

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error(`[Backend] Hiba az öntözés leállításakor (Zóna: ${zoneId}):`, err);
    return res.status(500).json({ error: 'Belső szerverhiba a leállítás során' });
  }
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

// MQTT connection lifecycle
mqttClient.on('connect', () => {
  console.log('[Backend] MQTT kliens csatlakozott a brokerhez.');
  // subscribe a status topicokra (szimulátor által használt topic)
  mqttClient.subscribe('garden/valves/+/status', (err) => {
    if (err) console.error('[Backend] MQTT subscribe hiba:', err);
    else console.log('[Backend] Feliratkozva: garden/valves/+/status');
  });
});

mqttClient.on('error', (err) => {
  console.error('[Backend] MQTT hiba:', err);
});

mqttClient.on('offline', () => {
  console.warn('[Backend] MQTT kliens offline.');
});

// MQTT üzenetek feldolgozása (status topic)
mqttClient.on('message', async (topic, message) => {
  try {
    // O(1) sebességű keresés a memóriában, string split és DB lekérdezés nélkül
    const zoneId = topicToZoneIdMap[topic];
    
    if (zoneId === undefined) {
      // Nem regisztrált topic
      return; 
    }

    const data = JSON.parse(message.toString());
    console.log(`📩 [Backend] MQTT üzenet feldolgozása (Zóna: ${zoneId}):`, data);

    const stopped = data && (data.event === 'STOPPED' || data.isActive === false || data.state === 'OFF');
    const currentStatus = !stopped;

    // KÖZVETLEN HARDVER VISSZAJELZÉS ALAPJÁN FRISSÍTJÜK A DB-T, HA KÍVÜLRŐL JÖTT A LEÁLLÁS (pl. időzítő lefutott a szimulátorban)
    await prisma.zone.update({
      where: { id: zoneId },
      data: { is_active: currentStatus }
    });

    if (stopped) {
      const hist = await prisma.history.findFirst({
        where: { zone_id: zoneId, status: 'IN_PROGRESS' },
        orderBy: { start_time: 'desc' }
      });
      if (hist) {
        await prisma.history.update({
          where: { id: hist.id },
          data: {
            end_time: new Date(),
            status: 'COMPLETED',
            water_used_l: data?.waterUsedL ?? undefined
          }
        });
      }
    }

    // Továbbküldés az SSE klienseknek
    const ssePayload = { type: 'ZONE_STATUS_CHANGE', zoneId, isActive: currentStatus };
    sseClients.forEach(client => client.write(`data: ${JSON.stringify(ssePayload)}\n\n`));
  } catch (err) {
    console.error('[Backend] MQTT message handling error:', err);
  }
});

async function bootstrap() {
  try {
    console.log('[Bootstrap] Rendszer inicializálása...');

    // 1. Opcionális: Megvárjuk, amíg a Prisma felépíti a Connection Pool-t
    await prisma.$connect();
    console.log('[Bootstrap] Adatbázis kapcsolat aktív.');

    // 2. Felépítjük a memóriatérképet (Cache) még a szerver indulása előtt!
    await buildTopicCache();
    console.log('[Bootstrap] MQTT Topic Cache felépítve.');

    // 3. Ha minden kritikus függőség él, csak akkor nyitjuk meg a HTTP portot
    const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
    const HOST = process.env.HOST || '0.0.0.0';
    
    app.listen(PORT, HOST, () => {
      console.log(`[Bootstrap] 🚀 Backend szerver sikeresen elindult a ${HOST}:${PORT} címen.`);
    });

  } catch (error) {
    // Ha nem tudjuk felépíteni a cache-t, leállítjuk a processzt.
    console.error('[Bootstrap] Kritikus hiba az indítás során! A folyamat leáll.', error);
    process.exit(1); 
  }
}

// Indítjuk a szekvenciát
bootstrap();

// cleanup
process.on('SIGINT', async () => {
  console.log('[Backend] Leállítás...');
  try { await prisma.$disconnect(); } catch (_) {}
  try { mqttClient.end(); } catch (_) {}
  process.exit(0);
});