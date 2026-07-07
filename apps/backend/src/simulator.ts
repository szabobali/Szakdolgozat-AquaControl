import { Aedes } from 'aedes';
import { createServer } from 'net';
import mqtt from 'mqtt';

const activeTimers = new Map<string, NodeJS.Timeout>();

async function start() {
  try {
    console.log('🤖 [Simulator] Broker inicializálása...');
    const aedes = await Aedes.createBroker();
    
    const PORT = 1883;
    const server = createServer(aedes.handle);

    server.listen(PORT, () => {
      console.log(`📡 [Simulator] MQTT Broker fut a ${PORT}-os porton!`);

      const client = mqtt.connect(`mqtt://localhost:${PORT}`);

      client.on('connect', () => {
        console.log('🤖 [Simulator] MQTT Kliens csatlakozva a saját brókerhez!');
        client.subscribe('garden/valves/+/command');
      });

      client.on('message', (topic, message) => {
        const msgStr = message.toString();
        console.log(`🤖 [Simulator] Üzenet érkezett: "${topic}" -> ${msgStr}`);

        if (topic.endsWith('/command')) {
          const parts = topic.split('/');
          const zoneId = parts[2];

          // VÉDŐVONAL (Guard Clause): Ha a topic nem a várt formátumú, eldobjuk.
          // Ez egyben megmondja a TypeScriptnek is, hogy ezen a ponton túl a zoneId BIZTOSAN string.
          if (!zoneId) {
            console.warn(`🤖 [Simulator] Érvénytelen topic struktúra, hiányzó zoneId: ${topic}`);
            return;
          }

          try {
            const payload = JSON.parse(msgStr);
            const statusTopic = `garden/valves/${zoneId}/status`;

            if (payload.state === 'ON') {
              console.log(`✅ [Simulator] Zóna ${zoneId} NYITÁSA...`);
              
              // 1. MEGSZAKÍTÁS KEZELÉS
              if (activeTimers.has(zoneId)) {
                clearTimeout(activeTimers.get(zoneId));
                console.log(`⏳ [Simulator] Korábbi időzítő felülírva a(z) ${zoneId}. zónán.`);
              }

              // 2. Státusz azonnali visszajelzése a Backendnek
              const statusPayload = JSON.stringify({ state: 'ON' });
              client.publish(statusTopic, statusPayload, () => {
                console.log(`📤 [Simulator] Státusz üzenet elküldve: ${statusTopic} -> ${statusPayload}`);
              });

              // 3. IDŐZÍTŐ LOGIKA INDÍTÁSA
              const durationSeconds = payload.duration_seconds || 60; 
              console.log(`⏱️ [Simulator] Hardveres visszaszámlálás indítása: ${durationSeconds} másodperc...`);

              const timer = setTimeout(() => {
                console.log(`⏰ [Simulator] Időzítő lejárt! Zóna ${zoneId} automatikus ZÁRÁSA...`);
                client.publish(statusTopic, JSON.stringify({ state: 'OFF', event: 'STOPPED' }));
                activeTimers.delete(zoneId);
              }, durationSeconds * 1000);

              // 4. Referencia eltárolása a memóriában
              activeTimers.set(zoneId, timer);

            } else if (payload.state === 'OFF') {
              console.log(`🛑 [Simulator] Zóna ${zoneId} ZÁRÁSA (Kézi parancs)...`);
              
              // 1. MEGSZAKÍTÁS KEZELÉS
              if (activeTimers.has(zoneId)) {
                clearTimeout(activeTimers.get(zoneId));
                activeTimers.delete(zoneId);
                console.log(`⏳ [Simulator] Autonóm időzítő megszakítva a(z) ${zoneId}. zónán.`);
              }

              // 2. Státusz visszajelzése
              client.publish(statusTopic, JSON.stringify({ state: 'OFF' }));
            }
          } catch (e) {
            console.error("🤖 [Simulator] Hiba a payload feldolgozásában:", e);
          }
        }
      });
    });
  } catch (e) {
    console.error('🤖 [Simulator] Hiba az inicializáláskor:', e);
  }
}

start();