# Broker setup (private, TLS, per-device ACLs)

The compose stack mounts this directory into Mosquitto at `/mosquitto/config`.

## 1. Device and backend accounts

```bash
# inside the repo root, with the mosquitto image available:
docker run --rm -it -v "$PWD/broker:/m" eclipse-mosquitto:2 sh -c '
  mosquitto_passwd -c /m/passwords backend      # will prompt for a password
  mosquitto_passwd    /m/passwords esp32-01     # one per device
'
```

## 2. TLS certificate

For a private LAN/bench setup, a self-signed CA is fine:

```bash
mkdir -p broker/certs
# one-time CA
openssl req -x509 -newkey rsa:2048 -days 3650 -nodes \
  -keyout broker/certs/ca.key -out broker/certs/ca.crt -subj "/CN=SolarCool CA"
# broker server cert (CN must be the hostname the ESP32/backend dial)
openssl req -newkey rsa:2048 -nodes \
  -keyout broker/certs/server.key -out broker/certs/server.csr -subj "/CN=mosquitto"
openssl x509 -req -in broker/certs/server.csr -days 3650 \
  -CA broker/certs/ca.crt -CAkey broker/certs/ca.key -CAcreateserial \
  -out broker/certs/server.crt
```

Copy `ca.crt` into the firmware (`CA_CERT` in the `.ino`) and point the
backend's `MQTT_CA` env var at it. For a broker with a public hostname,
use Let's Encrypt instead and skip the CA distribution entirely.

## 3. Run

```bash
docker compose up    # uses broker/mosquitto.conf (TLS listener on 8883)
```

`mosquitto.conf` also contains a commented plaintext listener for bench
development — enable it only on a trusted network.
