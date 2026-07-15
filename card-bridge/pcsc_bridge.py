"""
PC/SC multi-reader bridge for ACS NFC readers (ACR122U / ACR1252U class).

Reads up to three readers on one PC and tags every tap with its role:
    desk   - registration table (assign cards / recharge)
    gate1  - door 1
    gate2  - door 2

Serves the same local HTTP API the web app already polls:
    GET  /tap       -> {"seq": N, "uid": "04A1B2...", "reader": "gate1"}
    GET  /readers   -> detected readers and their role mapping
    POST /feedback  -> {"reader": "gate1", "ok": true}   flashes LED / beeps

Roles are assigned to readers sorted by name: 1st=desk, 2nd=gate1, 3rd=gate2.
To override, create readers.json next to this file, e.g. {"desk":2,"gate1":0,"gate2":1}
(values are indexes into the sorted reader list shown by GET /readers).

Requires: any Python 3 (64-bit fine) + `pip install pyscard`.
Windows supplies the PC/SC service; the ACS driver installs with the reader.
"""

import json
import os
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

try:
    from smartcard.System import readers as pcsc_readers
    from smartcard.Exceptions import NoCardException, CardConnectionException
except ImportError:
    print("pyscard is not installed. Run:  py -m pip install pyscard")
    sys.exit(1)

PORT = 47113
ROLES = ["desk", "gate1", "gate2"]
GET_UID = [0xFF, 0xCA, 0x00, 0x00, 0x00]  # PC/SC standard: get card UID

# ---- shared state -----------------------------------------------------------
state_lock = threading.Lock()
latest = {"seq": 0, "uid": "", "reader": ""}
reader_map = {}  # role -> smartcard reader object
feedback_q = {}  # role -> "ok" | "err" (picked up by that reader's poll thread)


def publish(uid, role):
    with state_lock:
        latest["seq"] += 1
        latest["uid"] = uid
        latest["reader"] = role
    print(f"[tap] {role}: {uid}")


# ---- ACR122U LED / buzzer ---------------------------------------------------
# Pseudo-APDU FF 00 40 <P2> 04 <T1 T2 reps buzzer>. Sent while the card is
# still on the reader (people hold it ~1s, which is enough). Every call is
# best-effort: if the reader model differs or the card left, we silently skip —
# feedback lights are a bonus, never a dependency. Timings are in 100ms units.
LED_OK = ([0xFF, 0x00, 0x40, 0x28, 0x04, 0x02, 0x00, 0x01, 0x01], "green + 1 beep")
LED_ERR = ([0xFF, 0x00, 0x40, 0x50, 0x04, 0x01, 0x01, 0x02, 0x03], "red blink + 2 beeps")
BUZZ_OFF = [0xFF, 0x00, 0x52, 0x00, 0x00]  # mute the default beep-on-detect


def try_apdu(conn, apdu):
    try:
        conn.transmit(apdu)
        return True
    except Exception:
        return False


# ---- per-reader poll thread ---------------------------------------------------
def poll_reader(role, reader):
    print(f"[bridge] {role} <- {reader}")
    last_uid = None      # UID currently on the reader (dedup while it sits there)
    muted = False
    while True:
        fb = feedback_q.pop(role, None)
        try:
            conn = reader.createConnection()
            conn.connect()  # raises NoCardException when nothing is on the pad
            data, sw1, sw2 = conn.transmit(GET_UID)
            if sw1 == 0x90 and data:
                uid = "".join(f"{b:02X}" for b in data)
                if not muted:
                    muted = try_apdu(conn, BUZZ_OFF)
                if uid != last_uid:
                    last_uid = uid
                    publish(uid, role)
                if fb:
                    try_apdu(conn, LED_OK[0] if fb == "ok" else LED_ERR[0])
            try:
                conn.disconnect()
            except Exception:
                pass
        except NoCardException:
            last_uid = None
        except CardConnectionException:
            last_uid = None
        except Exception:
            last_uid = None
            time.sleep(1)  # reader unplugged? don't spin
        time.sleep(0.12)


# ---- HTTP API ----------------------------------------------------------------
class Handler(BaseHTTPRequestHandler):
    def _headers(self, code=200):
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Private-Network", "true")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()

    def do_OPTIONS(self):
        self._headers(204)

    def do_GET(self):
        if self.path.startswith("/tap"):
            with state_lock:
                body = json.dumps(latest)
            self._headers()
            self.wfile.write(body.encode())
        elif self.path.startswith("/readers"):
            body = json.dumps({role: str(r) for role, r in reader_map.items()})
            self._headers()
            self.wfile.write(body.encode())
        else:
            self._headers(404)
            self.wfile.write(b'{"error":"not found"}')

    def do_POST(self):
        if self.path.startswith("/feedback"):
            try:
                n = int(self.headers.get("Content-Length", 0))
                data = json.loads(self.rfile.read(n) or b"{}")
                role = data.get("reader", "")
                if role in reader_map:
                    feedback_q[role] = "ok" if data.get("ok") else "err"
                self._headers()
                self.wfile.write(b'{"ok":true}')
            except Exception:
                self._headers(400)
                self.wfile.write(b'{"error":"bad request"}')
        else:
            self._headers(404)
            self.wfile.write(b'{"error":"not found"}')

    def log_message(self, *args):
        pass  # keep the console readable — taps are logged explicitly


# ---- startup -----------------------------------------------------------------
def main():
    rs = sorted(pcsc_readers(), key=str)
    if not rs:
        print("No PC/SC readers found. Plug in the ACS reader(s) and re-run.")
        sys.exit(1)

    overrides = {}
    cfg = os.path.join(os.path.dirname(os.path.abspath(__file__)), "readers.json")
    if os.path.exists(cfg):
        with open(cfg) as f:
            overrides = json.load(f)

    for i, role in enumerate(ROLES):
        idx = overrides.get(role, i)
        if isinstance(idx, int) and 0 <= idx < len(rs):
            reader_map[role] = rs[idx]

    print(f"[bridge] {len(rs)} reader(s) detected:")
    for role, r in reader_map.items():
        threading.Thread(target=poll_reader, args=(role, r), daemon=True).start()

    print(f"[bridge] serving http://127.0.0.1:{PORT}  (Ctrl+C to stop)")
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
