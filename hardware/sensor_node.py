import time
import json
import board
import busio
import adafruit_ahtx0
import adafruit_bmp280
import paho.mqtt.client as mqtt
import adafruit_ads1x15.ads1115 as ADS
from adafruit_ads1x15.analog_in import AnalogIn
from gpiozero import DigitalInputDevice

# --- Konfiguráció ---
MQTT_BROKER = "127.0.0.1"
MQTT_PORT = 1883
MQTT_TOPIC = "sensors/zone1"
READ_INTERVAL = 60
VOLTAGE_DRY = 3.0
VOLTAGE_WET = 1.2
FLOW_PIN = 17
pulse_count = 0
last_publish_time = time.time()

try:
    flow_sensor = DigitalInputDevice(FLOW_PIN, pull_up=True)
    print("[INIT] Átfolyásmérő megszakítások aktívak.")
except Exception as e:
    print(f"[HIBA] Átfolyásmérő inicializálása sikertelen: {e}")
    flow_sensor = None

def flow_pulse_callback():
    global pulse_count
    pulse_count += 1

if flow_sensor:
    flow_sensor.when_activated = flow_pulse_callback

# --- Hardver Inicializálása ---
try:
    # I2C busz megnyitása
    i2c = busio.I2C(board.SCL, board.SDA)
    
    # Szenzor objektumok példányosítása
    aht20 = adafruit_ahtx0.AHTx0(i2c)
    bmp280 = adafruit_bmp280.Adafruit_BMP280_I2C(i2c)
    ads = ADS.ADS1115(i2c)
    soil_chan = AnalogIn(ads, 0)
    
    # A tengerszinti nyomás kalibrálása (opcionális a pontos magasságméréshez)
    bmp280.sea_level_pressure = 1013.25
    print("[HARDVER] I2C Szenzorok sikeresen inicializálva.")
except Exception as e:
    print(f"[KRITIKUS HIBA] Nem sikerült csatlakozni a szenzorokhoz! Ellenőrizd a kábeleket. Hiba: {e}")
    exit(1)

def get_soil_moisture_percent():
    if ads is None:
        return None
    
    try:
        # A nyers feszültség kiolvasása az A0 lábról
        voltage = soil_chan.voltage
        
        # 1. Határértékek levágása (hogy ne kapjunk negatív vagy 100% feletti értéket)
        if voltage >= VOLTAGE_DRY:
            return 0.0
        if voltage <= VOLTAGE_WET:
            return 100.0
            
        # 2. Lineáris interpoláció (arányosítás a két végpont között)
        moisture = 100.0 * (1 - ((voltage - VOLTAGE_WET) / (VOLTAGE_DRY - VOLTAGE_WET)))
        
        return round(moisture, 1)
        
    except Exception as e:
        print(f"[SZENZOR HIBA] Nem sikerült olvasni a talajnedvességet: {e}")
        return None
# --- Üzenetküldő Logika ---
def publish_sensor_data(client):
    global pulse_count, last_publish_time
    try:
        current_pulses = pulse_count
        pulse_count = 0
        
        current_time = time.time()
        time_elapsed = current_time - last_publish_time
        last_publish_time = current_time

        volume_liters = current_pulses / 450.0
        if time_elapsed > 0:
            flow_rate_l_min = (volume_liters / time_elapsed) * 60.0
        else:
            flow_rate_l_min = 0.0

        temp = aht20.temperature
        hum = aht20.relative_humidity
        press = bmp280.pressure
        soil_moisture = get_soil_moisture_percent()

        payload = {
            "zone_id": 1,
            "temperature": round(temp, 2),
            "humidity": round(hum, 2),
            "atmospheric_pressure": round(press, 2),
            "soil_moisture": soil_moisture,
            "flow_rate": round(flow_rate_l_min, 2), # Frontend
            "volume_added": round(volume_liters, 4) # Water Used
        }

        json_payload = json.dumps(payload)
        result = client.publish(MQTT_TOPIC, json_payload, qos=1)
        
        if result.rc == mqtt.MQTT_ERR_SUCCESS:
            print(f"[{time.strftime('%H:%M:%S')}] MQTT OK: Áramlás: {flow_rate_l_min:.2f} L/m")
        else:
            print(f"[HIBA] MQTT publikálás sikertelen. Kód: {result.rc}")

    except Exception as e:
        print(f"[HIBA] Szenzor olvasási hiba: {e}")

# --- Fő Ciklus ---
if __name__ == "__main__":
    client = mqtt.Client()
    try:
        client.connect(MQTT_BROKER, MQTT_PORT, 60)
        client.loop_start()
    except Exception as e:
        print(f"[HIBA] MQTT Broker nem elérhető: {e}")
        exit(1)

    print(f"Adatgyűjtés indítása. Ciklusidő: {READ_INTERVAL} másodperc...")
    try:
        while True:
            publish_sensor_data(client)

            time.sleep(READ_INTERVAL)
    except KeyboardInterrupt:
        print("\nKézi leállítás.")
    finally:
        client.loop_stop()
        client.disconnect()
