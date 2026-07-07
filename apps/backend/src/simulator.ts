import { Aedes } from 'aedes';
import { createServer } from 'net';
import mqtt from 'mqtt';

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
          const zoneId = topic.split('/')[2];
          try {
            const payload = JSON.parse(msgStr);
            if (payload.state === 'ON') {
              console.log(`✅ [Simulator] Zóna ${zoneId} NYITÁSA...`);
              
              const statusTopic = `garden/valves/${zoneId}/status`;
              const statusPayload = JSON.stringify({ state: 'ON' });
              
              client.publish(statusTopic, statusPayload, () => {
                console.log(`📤 [Simulator] Státusz üzenet elküldve: ${statusTopic} -> ${statusPayload}`);
              });
            } else if (payload.state === 'OFF') {
              console.log(`🛑 [Simulator] Zóna ${zoneId} ZÁRÁSA...`);
              client.publish(`garden/valves/${zoneId}/status`, JSON.stringify({ state: 'OFF' }));
            }
          } catch (e) {
            console.error("Hiba a payload feldolgozásában:", e);
          }
        }
      });
    });
  } catch (e) {
    console.error('🤖 [Simulator] Hiba:', e);
  }
}

start();