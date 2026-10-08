import express from 'express';
import cors from 'cors';
import { connect } from 'mqtt';
import { PrismaClient, Zone, History, SensorReading } from '@prisma/client';
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
  zones.forEach((z: { id: number; mqtt_topic_status: string }) => {
    // Ha van az adatbázisban fix topic, azt használjuk. 
    // Ha nincs, generáljuk le az alapértelmezett konvenció alapján!
    const statusTopic = z.mqtt_topic_status || `garden/valves/${z.id}/status`;
    topicToZoneIdMap[statusTopic] = z.id;
  });

  // Debug log, hogy lásd, mik kerültek be a memóriába:
  console.log('[Backend] MQTT Topic Cache felépítve:', topicToZoneIdMap);
}
async function getExpectedRainMmCached(): Promise<number> {
  const CACHE_TTL_MS = 60 * 60 * 1000; // 1 óra
  const now = Date.now();

  if (now - weatherCache.lastUpdated < CACHE_TTL_MS) {
    return weatherCache.forecastRainMm;
  }

  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=47.3533&longitude=18.2711&hourly=precipitation&timezone=Europe%2FBudapest&forecast_days=2`;
    const response = await fetch(url);
    
    if (!response.ok) throw new Error(`HTTP hiba: ${response.status}`);
    
    const data = await response.json();
  
    const currentHour = new Date().getHours();
    const upcomingRain = data.hourly.precipitation.slice(currentHour, currentHour + 12);
    const totalRain = upcomingRain.reduce((sum: number, val: number) => sum + val, 0);
    
    weatherCache.forecastRainMm = totalRain;
    weatherCache.lastUpdated = now;
    
    console.log(`[Weather] 🌤️ Friss előrejelzés lekérve az Open-Meteo-tól. Várható eső (12h): ${totalRain.toFixed(1)} mm.`);
    return totalRain;

  } catch (error) {
    console.error("[Weather] Hiba az időjárás lekérésekor:", error);
    return weatherCache.forecastRainMm || 0; 
  }
}

// Prisma
const prisma = new PrismaClient();
await prisma.$connect();
// Explicit WAL mód és szinkronizációs beállítás az SD kártya kímélésére
await prisma.$queryRawUnsafe(`PRAGMA journal_mode = WAL;`);
await prisma.$queryRawUnsafe(`PRAGMA synchronous = NORMAL;`);
console.log("SQLite WAL mode activated for SD card protection.");

// Bulk Insert

// Globális vagy osztály-szintű puffer a memóriában
let sensorBuffer: Array<{
  temperature: number | null; 
  soil_moisture: number | null;
  humidity: number | null;
  atmospheric_pressure: number | null;
}> = [];

let weatherCache = {
  forecastRainMm: 0,
  lastUpdated: 0
};

let latestSensorData: any = null;

let currentSessionWaterLiters = 0;

function handleIncomingSensorData(data: any) {
  sensorBuffer.push(data);
}

// Data Retention

// Napi egyszer lefutó takarító folyamat
setInterval(async () => {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const deleted = await prisma.sensorReading.deleteMany({
    where: {
      timestamp: {
        lt: thirtyDaysAgo
      }
    }
  });
  console.log(`Data retention routine: Deleted ${deleted.count} old records.`);
}, 24 * 60 * 60 * 1000);

// MQTT
const mqttClient = connect('mqtt://localhost:1883');
let sseClients: any[] = [];

// GET /api/zones - Zónák lekérése az adatbázisból
app.get('/api/zones', async (req, res) => {
  try {
    console.log('[Backend] DB: Zónák lekérése...');
    const zones = await prisma.zone.findMany();
    // Map to frontend shape
    const mapped = zones.map((z: Zone) => ({
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

app.post('/api/zones/:zoneId/start', async (req, res) => {
  const zoneId = parseInt(req.params.zoneId, 10);
  const { duration } = req.body; 

  if (isNaN(zoneId)) {
    return res.status(400).json({ error: 'Érvénytelen zóna azonosító' });
  }

  try {
    console.log(`[Backend] Öntözés indítása kérés érkezett - Zóna: ${zoneId}, Időtartam: ${duration} perc`);

    // 1. Lokális DB állapot frissítése (optimista UI)
    await prisma.zone.update({
      where: { id: zoneId },
      data: { is_active: true }
    });

    // 2. MQTT parancs kiküldése (Fire and Forget a hardver felé)
    const topic = `garden/valves/${zoneId}/command`;
    const payload = JSON.stringify({
      action: 'START',
      duration_minutes: duration || 15
    });

    mqttClient.publish(topic, payload, { qos: 1 });

    // 3. Azonnali SSE push a frontend klienseknek az optimista állapot-szinkronizációért
    const ssePayload = { type: 'ZONE_STATUS_CHANGE', zoneId, isActive: true };
    sseClients.forEach(client => client.write(`data: ${JSON.stringify(ssePayload)}\n\n`));

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error(`[Backend] Hiba az öntözés indításakor (Zóna: ${zoneId}):`, err);
    return res.status(500).json({ error: 'Belső szerverhiba az indítás során' });
  }
});

// POST /api/zones/:zoneId/stop - Kézi leállítás MQTT parancsként
app.post('/api/zones/:zoneId/stop', async (req, res) => {
  const zoneId = parseInt(req.params.zoneId, 10);

  if (isNaN(zoneId)) {
    return res.status(400).json({ error: 'Érvénytelen zóna azonosító' });
  }

  try {
    console.log(`[Backend] Öntözés kézi leállítása kérés érkezett - Zóna: ${zoneId}`);

    // 1. MQTT leállító parancs kiküldése a hardvernek
    const topic = `garden/valves/${zoneId}/command`;
    const payload = JSON.stringify({ action: 'STOP' });

    mqttClient.publish(topic, payload, { qos: 1 });

    // (A DB frissítést és a History lezárást innentől a hardver visszajelzése fogja elvégezni!)

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
  mqttClient.subscribe('sensors/#', (err) => {
    if (err) console.error('[Backend] MQTT subscribe hiba (sensors):', err);
    else console.log('[Backend] Feliratkozva: sensors/#');
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
  // ==========================================
  // 1. ÁG: IDŐSOROS SZENZORADATOK FELDOLGOZÁSA
  // ==========================================
  if (topic.startsWith('sensors/')) {
  try {
    const payload = JSON.parse(message.toString());
    
    const temp = payload.temperature !== undefined ? Number(payload.temperature) : null;
    const moisture = payload.soil_moisture !== undefined ? Number(payload.soil_moisture) : null;
    const hum = payload.humidity !== undefined ? Number(payload.humidity) : null;
    const press = payload.atmospheric_pressure !== undefined ? Number(payload.atmospheric_pressure) : null;

    const currentReading = { temperature: temp, soil_moisture: moisture, humidity: hum, atmospheric_pressure: press, flow_rate: payload.flow_rate ?? null};
    
    if (payload.volume_added) {
      currentSessionWaterLiters += Number(payload.volume_added);
    }

    // 1. Mentés a DB pufferbe
    sensorBuffer.push(currentReading);

    // 2. Mentés a RAM gyorsítótárba az oldalfrissítésekhez
    latestSensorData = currentReading;

    // 3. Valós idejű push a csatlakoztatott React klienseknek
    const ssePayload = { type: 'SENSOR_UPDATE', data: currentReading };
    sseClients.forEach(client => client.write(`data: ${JSON.stringify(ssePayload)}\n\n`));
    
  } catch (err) {
    console.warn(`[MQTT] Érvénytelen szenzor adat:`, message.toString());
  }
  return; 
}

  // ==========================================
  // 2. ÁG: SZELEPEK STÁTUSZÁNAK FELDOLGOZÁSA (Eredeti logika)
  // ==========================================
  if (topic.startsWith('garden/valves/') && topic.endsWith('/status')) {
    try {
      const payload = JSON.parse(message.toString());
      
      if (payload.action === 'FINISHED') {
        const zoneId = payload.zone;
        const duration = payload.actual_duration;
        const waterUsed = currentSessionWaterLiters;
        const reason = payload.reason;

        currentSessionWaterLiters = 0;
        
        console.log(`📩 [Backend] Szelep válasz (Zóna ${zoneId}): ZÁRVA. Tényleges idő: ${duration} perc. Ok: ${reason}`);

        await prisma.zone.update({
          where: { id: zoneId },
          data: { is_active: false }
        });

        const startTime = new Date(Date.now() - Math.floor(duration * 60 * 1000));
        await prisma.history.create({
          data: {
            zone_id: zoneId,
            start_time: startTime,
            end_time: new Date(),
            duration: duration,
            status: 'COMPLETED',
            trigger_source: reason === 'manual_stop' ? 'MANUAL' : 'SCHEDULED',
            water_used_l: Number(waterUsed.toFixed(2))
          }
        });

        // 4. SSE Frissítés a frontend felé, hogy pattanjon vissza a gomb
        const ssePayload = { type: 'ZONE_STATUS_CHANGE', zoneId, isActive: false };
        sseClients.forEach(client => client.write(`data: ${JSON.stringify(ssePayload)}\n\n`));
      }
    } catch (err) {
      console.error('[Backend] Hiba a szelep státusz feldolgozásakor:', err);
    }
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

    const dayColumns = [
      'day_sunday', 'day_monday', 'day_tuesday', 'day_wednesday', 
      'day_thursday', 'day_friday', 'day_saturday'
    ] as const;
    const todayColumn = dayColumns[currentDay];

    if (!todayColumn) return;

    // 1. Napi ütemezések lekérése
    const dueSchedules = await prisma.schedule.findMany({
      where: {
        is_enabled: true,
        time_of_day: currentTimeOfDay,
        [todayColumn]: true
      }
    });

    if (dueSchedules.length === 0) return;

    // Beállítások a prediktív logikához
    const settings = await prisma.systemSettings.findUnique({ where: { id: 1 } });

    // 2. Feladatok végrehajtása
    for (const schedule of dueSchedules) {
      const zoneId = schedule.zone_id;
      const duration = schedule.duration_mins;

      const zone = await prisma.zone.findUnique({ where: { id: zoneId } });
      if (zone?.is_active) {
        console.warn(`[Scheduler] ⚠️ Zóna ${zoneId} MÁR AKTÍV. Ütemezés átugorva.`);
        continue;
      }

      // ==========================================
      // 3. PREDIKTÍV ÉS REAKTÍV GATEKEEPER
      // ==========================================
      let skipWatering = false;
      let skipReason = "";

      if (settings?.rain_delay && latestSensorData) {
        const currentMoisture = latestSensorData.soil_moisture;
        const currentPressure = latestSensorData.atmospheric_pressure;
        const moistureThreshold = settings.moisture_threshold;

        // A) Reaktív: Tényleges csapadék detektálása (Az esőmérőként használt HW-390 nedves)
        if (currentMoisture !== null && currentMoisture > moistureThreshold) {
          skipWatering = true;
          skipReason = `Talajnedvesség magas (${currentMoisture}% > ${moistureThreshold}%) - Eső áztatta a szenzort.`;
        }
        
        const RAIN_PRESSURE_THRESHOLD = 1005; 
        if (!skipWatering && currentPressure !== null && currentPressure < RAIN_PRESSURE_THRESHOLD) {
          skipWatering = true;
          skipReason = `Alacsony légnyomás (${currentPressure} hPa) - Eső/vihar valószínűsíthető.`;
        }

        // C) Prediktív API (Open-Meteo Cache-elt hívás)
        if (!skipWatering) {
          const forecastRainMm = await getExpectedRainMmCached();
          if (forecastRainMm >= settings.rain_threshold) {
             skipWatering = true;
             skipReason = `Meteorológiai riasztás: ${forecastRainMm.toFixed(1)} mm eső várható a következő 12 órában.`;
          }
        }
      }

      // Döntés kiértékelése
      if (skipWatering) {
        console.log(`[Scheduler] 🚫 Zóna ${zoneId} időzített öntözése KIHAGYVA. Ok: ${skipReason}`);
        continue; // Megszakítjuk a ciklust, a parancs nem megy ki
      }

      // ==========================================
      // 4. ÖNTÖZÉS INDÍTÁSA (Ha zöld utat kapott)
      // ==========================================
      await prisma.history.create({
        data: {
          zone_id: zoneId,
          start_time: new Date(),
          status: 'IN_PROGRESS',
          trigger_source: 'SCHEDULED'
        }
      });

      await prisma.zone.update({
        where: { id: zoneId },
        data: { is_active: true }
      });

      const topic = zone?.mqtt_topic_cmd || `garden/valves/${zoneId}/command`;
      const payload = JSON.stringify({ action: 'START', duration_minutes: duration });
      mqttClient.publish(topic, payload, { qos: 1 });

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

// ==========================================
// TÖRTÉNET (HISTORY) API VÉGPONT
// ==========================================

// GET /api/history - Eseménynapló lekérése
app.get('/api/history', async (req, res) => {
  try {
    const historyRecords = await prisma.history.findMany({
      orderBy: { start_time: 'desc' }, // Legfrissebbek elöl
      take: 100, // Biztonsági limit (Pagination helyett egyelőre)
      include: {
        zone: true // SQL JOIN: Hozzárakja a zóna adatait, így meglesz a 'name'
      }
    });

    // DTO Leképezés: Prisma Entity -> Frontend formátum
    const frontendHistory = historyRecords.map((record) => {
      // Időtartam kiszámítása percekben
      let durationMins = 0;
      if (record.end_time) {
        const diffMs = record.end_time.getTime() - record.start_time.getTime();
        durationMins = Math.round(diffMs / 60000);
      } else if (record.status === 'IN_PROGRESS') {
        // Ha épp most is fut, kiszámoljuk az eddig eltelt időt
        const diffMs = new Date().getTime() - record.start_time.getTime();
        durationMins = Math.round(diffMs / 60000);
      }

      return {
        id: record.id.toString(),
        zoneName: record.zone.name,
        // ISO stringgé alakítjuk, hogy biztonságosan átmenjen a JSON-en
        startTime: record.start_time.toISOString(), 
        duration: durationMins,
        waterUsed: record.water_used_l || 0,
        // 'MANUAL' -> 'manual', 'SCHEDULED' -> 'scheduled'
        type: record.trigger_source.toLowerCase(), 
        status: record.status
      };
    });

    res.json(frontendHistory);
  } catch (err) {
    console.error('[Backend] Hiba a történet lekérésekor:', err);
    res.status(500).json({ error: 'Belső szerverhiba' });
  }
});

// ==========================================
// ZÓNA (ZONE) CRUD API VÉGPONTOK
// ==========================================

// POST /api/zones - Új zóna létrehozása
app.post('/api/zones', async (req, res) => {
  try {
    const { name, duration, mqttTopicCmd, mqttTopicStatus } = req.body;
    
    // Alapértelmezett topicok generálása, ha a felhasználó nem adott meg semmit
    const defaultId = Date.now().toString().slice(-4); // Ideiglenes azonosító a topicba
    const cmdTopic = mqttTopicCmd || `garden/valves/${defaultId}/command`;
    const statusTopic = mqttTopicStatus || `garden/valves/${defaultId}/status`;

    const newZone = await prisma.zone.create({
      data: {
        name: name || 'Új Zóna',
        default_duration: parseInt(duration, 10) || 15,
        mqtt_topic_cmd: cmdTopic,
        mqtt_topic_status: statusTopic,
        is_active: false
      }
    });

    // CACHE INVALIDÁCIÓ: Újraépítjük a memóriatérképet!
    await buildTopicCache();

    res.status(201).json({
      id: newZone.id.toString(),
      name: newZone.name,
      isActive: newZone.is_active,
      duration: newZone.default_duration,
      mqttTopicCmd: newZone.mqtt_topic_cmd,
      mqttTopicStatus: newZone.mqtt_topic_status
    });
  } catch (err) {
    console.error('[Backend] Hiba a zóna létrehozásakor:', err);
    res.status(500).json({ error: 'Létrehozás sikertelen' });
  }
});

// PUT /api/zones/:id - Meglévő zóna módosítása
app.put('/api/zones/:id', async (req, res) => {
  const zoneId = parseInt(req.params.id, 10);
  if (isNaN(zoneId)) return res.status(400).json({ error: 'Érvénytelen azonosító' });

  try {
    const { name, duration, mqttTopicCmd, mqttTopicStatus } = req.body;
    
    const updatedZone = await prisma.zone.update({
      where: { id: zoneId },
      data: {
        ...(name && { name }),
        ...(duration && { default_duration: parseInt(duration, 10) }),
        ...(mqttTopicCmd && { mqtt_topic_cmd: mqttTopicCmd }),
        ...(mqttTopicStatus && { mqtt_topic_status: mqttTopicStatus }),
      }
    });

    // CACHE INVALIDÁCIÓ: Ha változott a státusz topic, a RAM-nak is tudnia kell róla!
    await buildTopicCache();

    res.json({
      id: updatedZone.id.toString(),
      name: updatedZone.name,
      isActive: updatedZone.is_active,
      duration: updatedZone.default_duration,
      mqttTopicCmd: updatedZone.mqtt_topic_cmd,
      mqttTopicStatus: updatedZone.mqtt_topic_status
    });
  } catch (err) {
    console.error(`[Backend] Hiba a zóna frissítésekor (ID: ${zoneId}):`, err);
    res.status(500).json({ error: 'Frissítés sikertelen' });
  }
});

// DELETE /api/zones/:id - Zóna törlése
app.delete('/api/zones/:id', async (req, res) => {
  const zoneId = parseInt(req.params.id, 10);
  if (isNaN(zoneId)) return res.status(400).json({ error: 'Érvénytelen azonosító' });

  try {
    // Figyelem: A relációs adatbázisokban (Referential Integrity) először 
    // a kapcsolódó rekordokat (History, Schedule) kell törölni, különben a Prisma hibát dob!
    await prisma.history.deleteMany({ where: { zone_id: zoneId } });
    await prisma.schedule.deleteMany({ where: { zone_id: zoneId } });

    await prisma.zone.delete({ where: { id: zoneId } });

    // CACHE INVALIDÁCIÓ
    await buildTopicCache();

    res.status(200).json({ success: true });
  } catch (err) {
    console.error(`[Backend] Hiba a zóna törlésekor (ID: ${zoneId}):`, err);
    res.status(500).json({ error: 'Törlés sikertelen' });
  }
});

// ==========================================
// RENDSZER BEÁLLÍTÁSOK (SETTINGS) API VÉGPONTOK
// ==========================================

// DTO Segédfüggvény: DB Entity -> React State (snake_case -> camelCase)
const mapSettingsToFrontend = (dbSettings: any) => ({
  autoWatering: dbSettings.auto_watering,
  moistureThreshold: dbSettings.moisture_threshold,
  rainDelay: dbSettings.rain_delay,
  rainThreshold: dbSettings.rain_threshold,
  flowSensorEnabled: dbSettings.flow_sensor_enabled,
  defaultFlowRate: dbSettings.default_flow_rate,
  notifications: dbSettings.notifications
});

// GET /api/settings - Beállítások lekérése (vagy inicializálása)
app.get('/api/settings', async (req, res) => {
  try {
    let settings = await prisma.systemSettings.findUnique({ where: { id: 1 } });
    
    // Fallback: Ha még sosem volt elmentve, létrehozzuk a sémában definiált default értékekkel
    if (!settings) {
      settings = await prisma.systemSettings.create({ data: { id: 1 } });
      console.log('[Backend] Alapértelmezett beállítások inicializálva.');
    }
    
    res.json(mapSettingsToFrontend(settings));
  } catch (err) {
    console.error('[Backend] Hiba a beállítások lekérésekor:', err);
    res.status(500).json({ error: 'Belső szerverhiba' });
  }
});

// PUT /api/settings - Beállítások frissítése
app.put('/api/settings', async (req, res) => {
  try {
    const data = req.body;
    
    const updatedSettings = await prisma.systemSettings.update({
      where: { id: 1 },
      data: {
        ...(data.autoWatering !== undefined && { auto_watering: data.autoWatering }),
        ...(data.moistureThreshold !== undefined && { moisture_threshold: data.moistureThreshold }),
        ...(data.rainDelay !== undefined && { rain_delay: data.rainDelay }),
        ...(data.rainThreshold !== undefined && { rain_threshold: data.rainThreshold }),
        ...(data.flowSensorEnabled !== undefined && { flow_sensor_enabled: data.flowSensorEnabled }),
        ...(data.defaultFlowRate !== undefined && { default_flow_rate: data.defaultFlowRate }),
        ...(data.notifications !== undefined && { notifications: data.notifications }),
      }
    });

    res.json(mapSettingsToFrontend(updatedSettings));
  } catch (err) {
    console.error('[Backend] Hiba a beállítások frissítésekor:', err);
    res.status(500).json({ error: 'Frissítés sikertelen' });
  }
});

// ==========================================
// SZENZOR ADAT API
// ==========================================

app.get('/api/sensors/latest', (req, res) => {
  res.json(latestSensorData || { temperature: null, soil_moisture: null, humidity: null, pressure: null });
});

setInterval(async () => {
  if (sensorBuffer.length === 0) return;

  // Csak az érvényes (nem null) értékeket szűrjük ki a matematikához
  const temps = sensorBuffer.filter(r => r.temperature !== null).map(r => r.temperature as number);
  const hums = sensorBuffer.filter(r => r.humidity !== null).map(r => r.humidity as number);
  const press = sensorBuffer.filter(r => r.atmospheric_pressure !== null).map(r => r.atmospheric_pressure as number);
  const moists = sensorBuffer.filter(r => r.soil_moisture !== null).map(r => r.soil_moisture as number);

  // Segédfüggvény az átlagoláshoz (ha nincs adat, null-t ad vissza)
  const calcAvg = (arr: number[]) => arr.length > 0 ? Number((arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(2)) : null;

  try {
    await prisma.sensorReading.create({
      data: {
        temperature: calcAvg(temps),
        humidity: calcAvg(hums),
        atmospheric_pressure: calcAvg(press),
        soil_moisture: calcAvg(moists)
      }
    });
    
    console.log(`[DB] 20 perces szenzor átlag elmentve az SQLite-ba. (Feldolgozott minták: ${sensorBuffer.length})`);
    
    // Puffer biztonságos ürítése a következő ciklushoz
    sensorBuffer.length = 0; 
    
  } catch (error) {
    console.error('[DB] Kritikus hiba a szenzor adatok mentésekor:', error);
  }
}, 20 * 60 * 1000);

app.get('/api/sensors/history', async (req, res) => {
  try {
    const data = await prisma.sensorReading.findMany({
      orderBy: { timestamp: 'desc' },
      take: 504 
    });
    res.json(data.reverse());
  } catch (error) {
    res.status(500).json({ error: "Szerver hiba" });
  }
});

// TODO: TÖRÖLNI ÉLESÍTÉS ELŐTT! Fejlesztői végpont mock adatok generálására
app.get('/api/dev/seed-all', async (req, res) => {
  try {
    // Töröljük a korábbi tesztadatokat, hogy tiszta lapot kapjunk
    await prisma.sensorReading.deleteMany();  

    const now = Date.now();
    
    // Szenzor adatok generálása (elmúlt 7 nap, 20 percenként)
    for (let i = 504; i >= 0; i--) {
      const mockTime = new Date(now - i * 20 * 60 * 1000);
      
      // Napszakhoz kötött szinuszos ingadozás szimulálása
      const hour = mockTime.getHours();
      const tempBase = 15 + Math.sin((hour - 6) * Math.PI / 12) * 10; 
      
      await prisma.sensorReading.create({
        data: {
          temperature: Number((tempBase + Math.random() * 2).toFixed(1)),
          humidity: Number((40 + Math.random() * 20).toFixed(1)),
          atmospheric_pressure: Number((1010 + Math.random() * 15).toFixed(1)),
          soil_moisture: Number((30 + Math.random() * 30).toFixed(1)),
          timestamp: mockTime
        }
      });
    }

    res.json({ message: "7 napos szenzor és öntözés mock adatbázis sikeresen feltöltve!" });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});