import time
import json
import board
import busio
import adafruit_ahtx0
import adafruit_bmp280
import paho.mqtt.client as mqtt

# --- Konfiguráció ---
MQTT_BROKER = "127.0.0.1"
MQTT_PORT = 1883
MQTT_TOPIC = "sensors/zone1"
READ_INTERVAL = 60

# --- Hardver Inicializálása ---
try:
    # I2C busz megnyitása
    i2c = busio.I2C(board.SCL, board.SDA)
    
    # Szenzor objektumok példányosítása
    aht20 = adafruit_ahtx0.AHTx0(i2c)
    bmp280 = adafruit_bmp280.Adafruit_BMP280_I2C(i2c)
    
    # A tengerszinti nyomás kalibrálása (opcionális a pontos magasságméréshez)
    bmp280.sea_level_pressure = 1013.25
    print("[HARDVER] I2C Szenzorok sikeresen inicializálva.")
except Exception as e:
    print(f"[KRITIKUS HIBA] Nem sikerült csatlakozni a szenzorokhoz! Ellenőrizd a kábeleket. Hiba: {e}")
    exit(1)

# --- Üzenetküldő Logika ---
def publish_sensor_data(client):
    try:
        # 1. Valós adatok kiolvasása
        # A hőmérséklethez az AHT20-at használjuk, mert általában pontosabb a környezeti levegőre
        temp = aht20.temperature
        hum = aht20.relative_humidity
        press = bmp280.pressure

        # 2. Mockolt adat (Amíg nincs ADC modulod a HW-390-hez)
        soil_moisture_mock = 55.4

        payload = {
            "zone_id": 1,
            "temperature": round(temp, 2),
            "humidity": round(hum, 2),
            "atmospheric_pressure": round(press, 2),
            "soil_moisture": soil_moisture_mock
        }

        json_payload = json.dumps(payload)
        result = client.publish(MQTT_TOPIC, json_payload, qos=1)
        
        if result.rc == mqtt.MQTT_ERR_SUCCESS:
            print(f"[{time.strftime('%H:%M:%S')}] MQTT OK: {json_payload}")
        else:
            print(f"[HIBA] MQTT publikálás sikertelen. Kód: {result.rc}")

    except Exception as e:
        # Védelem: Ha futás közben kihúzódik a kábel, a program ne álljon le, 
        # csak dobjon hibát, és próbálkozzon újra a következő ciklusban.
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
