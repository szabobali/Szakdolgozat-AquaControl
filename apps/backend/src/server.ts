import express from 'express';
import cors from 'cors';
import { connect } from 'mqtt';
import { PrismaClient } from '@prisma/client';
import cron from 'node-cron';

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
    // Ha van az adatbázisban fix topic, azt használjuk. 
    // Ha nincs, generáljuk le az alapértelmezett konvenció alapján!
    const statusTopic = z.mqtt_topic_status || `garden/valves/${z.id}/status`;
    topicToZoneIdMap[statusTopic] = z.id;
  });
  
  // Debug log, hogy lásd, mik kerültek be a memóriába:
  console.log('[Backend] MQTT Topic Cache felépítve:', topicToZoneIdMap);
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
    // O(1) sebességű keresés a memóriában
    const zoneId = topicToZoneIdMap[topic];
    
    if (zoneId === undefined) {
      // Nem regisztrált topic, ignoráljuk
      return; 
    }

    const payload = message.toString();
    let data: any = null;
    try { data = JSON.parse(payload); } catch (e) { return; }

    console.log(`📩 [Backend] MQTT üzenet feldolgozása (Zóna: ${zoneId}):`, data);

    // 1. Állapot biztonságos kinyerése (támogatja a state: OFF és az isActive: false formátumot is)
    let isCurrentlyActive = false;
    if (typeof data.isActive === 'boolean') {
      isCurrentlyActive = data.isActive;
    } else if (data.state === 'ON') {
      isCurrentlyActive = true;
    } else if (data.state === 'OFF') {
      isCurrentlyActive = false;
    }

    // 2. KÖZVETLEN HARDVER VISSZAJELZÉS ALAPJÁN FRISSÍTJÜK A DB-T
    await prisma.zone.update({
      where: { id: zoneId },
      data: { is_active: isCurrentlyActive }
    });

    // 3. Ha leállt (bármilyen okból), lezárjuk a történetet
    const stopped = (data.event === 'STOPPED' || isCurrentlyActive === false);
    
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
        console.log(`[Backend] Öntözési történet lezárva (Zóna: ${zoneId})`);
      }
    }

    // 4. Továbbküldés az SSE klienseknek
    const ssePayload = { type: 'ZONE_STATUS_CHANGE', zoneId, isActive: isCurrentlyActive };
    sseClients.forEach(client => client.write(`data: ${JSON.stringify(ssePayload)}\n\n`));
    
  } catch (err) {
    console.error('[Backend] MQTT message handling error:', err);
  }
});

cron.schedule('* * * * *', async () => {
  try {
    const nowStr = new Date().toLocaleString("en-US", { timeZone: "Europe/Budapest" });
    const budapestTime = new Date(nowStr);
    
    const currentDay = budapestTime.getDay();
    const currentHour = budapestTime.getHours().toString().padStart(2, '0');
    const currentMinute = budapestTime.getMinutes().toString().padStart(2, '0');
    const currentTimeOfDay = `${currentHour}:${currentMinute}`;

    // 1. TÍPUSBIZTOS LEKÉPEZÉS (Megoldás a TS hibára)
    // Az "as const" kulcsszóval a TS egy fix tuple-ként kezeli, nem egy sima string[]-ként.
    const dayColumns = [
      'day_sunday', 'day_monday', 'day_tuesday', 'day_wednesday', 
      'day_thursday', 'day_friday', 'day_saturday'
    ] as const;
    
    // Így a todayColumn típusa már nem "string", hanem a fenti 7 érték egyike lesz (Union Type).
    const todayColumn = dayColumns[currentDay];

    // Mivel a Prisma nem engedi a dinamikus kulcsokat direktben a strongly-typed objektumban,
    // egy iteratív objektumépítést alkalmazunk, ami tiszteletben tartja a típusokat.
    // 2. VÉDŐVONAL (Guard Clause & Type Narrowing)
    if (!todayColumn) {
      console.error(`[Scheduler] Kritikus hiba: Érvénytelen nap index (${currentDay}).`);
      return;
    }
    // 2. Lekérdezés
    const dueSchedules = await prisma.schedule.findMany({
      where: {
        is_enabled: true,
        time_of_day: currentTimeOfDay,
        [todayColumn]: true // Itt már nem fog dobni sem TS2464-et, sem TS2538-at!
      }
    });

    if (dueSchedules.length > 0) {
      console.log(`[Scheduler] ⏰ ${currentTimeOfDay} - Találtam ${dueSchedules.length} db végrehajtandó ütemezést.`);
    }

    // 3. Végrehajtás és Peremeset védelem
    for (const schedule of dueSchedules) {
      const zoneId = schedule.zone_id;
      const duration = schedule.duration_mins;

      // ELŐZETES ÁLLAPOTVIZSGÁLAT (Edge case védelem)
      const zone = await prisma.zone.findUnique({ where: { id: zoneId } });
      
      if (zone?.is_active) {
        console.warn(`[Scheduler] ⚠️ Zóna ${zoneId} MÁR AKTÍV (valószínűleg kézi indítás). Az ütemezést átugorjuk az ütközés elkerülése végett.`);
        continue; // Kilépünk az aktuális iterációból, megyünk a következőre
      }

      // Készítünk egy History rekordot
      await prisma.history.create({
        data: {
          zone_id: zoneId,
          start_time: new Date(),
          status: 'IN_PROGRESS',
          trigger_source: 'SCHEDULED'
        }
      });

      // Frissítjük a Zóna állapotát
      await prisma.zone.update({
        where: { id: zoneId },
        data: { is_active: true }
      });

      // Publikáljuk az MQTT parancsot
      const topic = zone?.mqtt_topic_cmd || `garden/valves/${zoneId}/command`;
      const payload = JSON.stringify({
        state: 'ON',
        duration_seconds: duration * 60
      });

      mqttClient.publish(topic, payload, { qos: 1 });

      // SSE Frissítés
      const ssePayload = { type: 'ZONE_STATUS_CHANGE', zoneId, isActive: true };
      sseClients.forEach(client => client.write(`data: ${JSON.stringify(ssePayload)}\n\n`));

      console.log(`[Scheduler] 🚀 Zóna ${zoneId} automatikusan elindítva ${duration} percre.`);
    }

  } catch (error) {
    console.error('[Scheduler] Kritikus hiba az ütemező futásakor:', error);
  }
}, {
  timezone: "Europe/Budapest"
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

// ==========================================
// ÜTEMEZÉSEK (SCHEDULES) API VÉGPONTOK
// ==========================================

// Segédfüggvény: Prisma Entity -> Frontend DTO
const mapDbScheduleToFrontend = (dbSchedule: any) => {
  const days = [];
  if (dbSchedule.day_sunday) days.push(0);
  if (dbSchedule.day_monday) days.push(1);
  if (dbSchedule.day_tuesday) days.push(2);
  if (dbSchedule.day_wednesday) days.push(3);
  if (dbSchedule.day_thursday) days.push(4);
  if (dbSchedule.day_friday) days.push(5);
  if (dbSchedule.day_saturday) days.push(6);

  return {
    id: dbSchedule.id.toString(),
    zoneId: dbSchedule.zone_id.toString(),
    time: dbSchedule.time_of_day,
    duration: dbSchedule.duration_mins,
    days: days,
    enabled: dbSchedule.is_enabled
  };
};

// Segédfüggvény: Frontend DTO -> Prisma Entity adatok (csak a napok)
const mapDaysToDbColumns = (days: number[]) => {
  return {
    day_sunday: days.includes(0),
    day_monday: days.includes(1),
    day_tuesday: days.includes(2),
    day_wednesday: days.includes(3),
    day_thursday: days.includes(4),
    day_friday: days.includes(5),
    day_saturday: days.includes(6)
  };
};

// GET /api/schedules - Összes ütemezés lekérése
app.get('/api/schedules', async (req, res) => {
  try {
    const schedules = await prisma.schedule.findMany();
    const frontendSchedules = schedules.map(mapDbScheduleToFrontend);
    res.json(frontendSchedules);
  } catch (err) {
    console.error('[Backend] Hiba az ütemezések lekérésekor:', err);
    res.status(500).json({ error: 'Belső szerverhiba' });
  }
});

// POST /api/schedules - Új ütemezés létrehozása
app.post('/api/schedules', async (req, res) => {
  try {
    const { zoneId, time, duration, days, enabled } = req.body;

    const newSchedule = await prisma.schedule.create({
      data: {
        zone_id: parseInt(zoneId, 10),
        time_of_day: time,
        duration_mins: parseInt(duration, 10),
        is_enabled: enabled ?? true,
        ...mapDaysToDbColumns(days)
      }
    });

    res.status(201).json(mapDbScheduleToFrontend(newSchedule));
  } catch (err) {
    console.error('[Backend] Hiba az ütemezés mentésekor:', err);
    res.status(500).json({ error: 'Mentés sikertelen' });
  }
});

// PUT /api/schedules/:id - Meglévő ütemezés frissítése (pl. engedélyezés/tiltás vagy módosítás)
app.put('/api/schedules/:id', async (req, res) => {
  const scheduleId = parseInt(req.params.id, 10);
  if (isNaN(scheduleId)) return res.status(400).json({ error: 'Érvénytelen azonosító' });

  try {
    const { zoneId, time, duration, days, enabled } = req.body;
    
    // Csak a kapott adatokat frissítjük
    const updateData: any = {};
    if (zoneId !== undefined) updateData.zone_id = parseInt(zoneId, 10);
    if (time !== undefined) updateData.time_of_day = time;
    if (duration !== undefined) updateData.duration_mins = parseInt(duration, 10);
    if (enabled !== undefined) updateData.is_enabled = enabled;
    if (days !== undefined) Object.assign(updateData, mapDaysToDbColumns(days));

    const updatedSchedule = await prisma.schedule.update({
      where: { id: scheduleId },
      data: updateData
    });

    res.json(mapDbScheduleToFrontend(updatedSchedule));
  } catch (err) {
    console.error(`[Backend] Hiba az ütemezés frissítésekor (ID: ${scheduleId}):`, err);
    res.status(500).json({ error: 'Frissítés sikertelen' });
  }
});

// DELETE /api/schedules/:id - Ütemezés törlése
app.delete('/api/schedules/:id', async (req, res) => {
  const scheduleId = parseInt(req.params.id, 10);
  if (isNaN(scheduleId)) return res.status(400).json({ error: 'Érvénytelen azonosító' });

  try {
    await prisma.schedule.delete({
      where: { id: scheduleId }
    });
    res.status(200).json({ success: true });
  } catch (err) {
    console.error(`[Backend] Hiba az ütemezés törlésekor (ID: ${scheduleId}):`, err);
    res.status(500).json({ error: 'Törlés sikertelen' });
  }
});
