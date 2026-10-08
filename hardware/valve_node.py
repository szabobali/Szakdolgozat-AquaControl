import time
import json
import threading
import paho.mqtt.client as mqtt

try:
    from gpiozero import DigitalOutputDevice
    VALVE_PIN = 27
    valve = DigitalOutputDevice(VALVE_PIN, active_high=True, initial_value=False)
except Exception as e:
    print(f"[KRITIKUS HIBA] GPIO inicializálás sikertelen: {e}")
    exit(1)

# --- KONFIGURÁCIÓ ---
MQTT_BROKER = "localhost"  
ZONE_ID = 1 
COMMAND_TOPIC = f"garden/valves/{ZONE_ID}/command"
STATUS_TOPIC = f"garden/valves/{ZONE_ID}/status"

# --- ÁLLAPOT GÉP ---
current_timer = None
start_time = 0

def close_valve(client, reason="timeout"):
    global current_timer, start_time
    
    valve.off()
    
    if current_timer is not None:
        current_timer.cancel()
        current_timer = None
        
    actual_duration = 0
    if start_time > 0:
        actual_duration = round((time.time() - start_time) / 60.0, 2)
        
    print(f"[ZÓNA {ZONE_ID}] ZÁRVA. Ok: {reason}. Tényleges idő: {actual_duration} perc.")
    
    payload = {
        "action": "FINISHED",
        "zone": ZONE_ID,
        "actual_duration": actual_duration,
        "reason": reason
    }
    client.publish(STATUS_TOPIC, json.dumps(payload))
        
    start_time = 0

def on_message(client, userdata, msg):
    """Az MQTT üzenetek aszinkron feldolgozója"""
    global current_timer, start_time
    
    try:
        payload = json.loads(msg.payload.decode())
        action = payload.get("action")
        
        if action == "START":
            duration_minutes = payload.get("duration_minutes", 0)
            if duration_minutes <= 0:
                print(f"[ZÓNA {ZONE_ID} HIBA] Érvénytelen időtartam a START parancsban.")
                return
            
            if valve.value == 1:
                close_valve(client, reason="override")
                
            print(f"[ZÓNA {ZONE_ID}] NYITÁS -> Tervezett időtartam: {duration_minutes} perc.")
            
            valve.on()
            start_time = time.time()
            
            duration_seconds = duration_minutes * 60
            current_timer = threading.Timer(duration_seconds, close_valve, args=[client, "timeout"])
            current_timer.start()
            
        elif action == "STOP":
            print(f"[ZÓNA {ZONE_ID}] Kézi STOP parancs érkezett.")
            close_valve(client, reason="manual_stop")
            
    except json.JSONDecodeError:
        print(f"[ZÓNA {ZONE_ID} HIBA] Érvénytelen JSON formátum.")
    except Exception as e:
        print(f"[ZÓNA {ZONE_ID} HIBA] Váratlan hiba: {e}")
        close_valve(client, reason="error")

def main():
    client = mqtt.Client(client_id=f"AquaControl_Valve_{ZONE_ID}")
    client.on_message = on_message
    
    try:
        client.connect(MQTT_BROKER, 1883, 60)
        client.subscribe(COMMAND_TOPIC)
        print(f"[INIT] Zóna {ZONE_ID} Failsafe Vezérlő aktív. Hallgatás: '{COMMAND_TOPIC}'...")
        client.loop_forever()
        
    except KeyboardInterrupt:
        print("\n[LEÁLLÍTÁS] A felhasználó megszakította a futást.")
    except Exception as e:
        print(f"[KRITIKUS HIBA] MQTT hálózat: {e}")
    finally:
        print(f"[FAILSAFE] Zóna {ZONE_ID} hardveres biztonsági zárás.")
        valve.off()
        if current_timer:
            current_timer.cancel()
        client.disconnect()

if __name__ == "__main__":
    main()