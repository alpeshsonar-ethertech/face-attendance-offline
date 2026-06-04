#!/usr/bin/env python3
"""
Local attendance sync test server (stands in for the AWS endpoint).
Accepts the exact POST your app sends when sync.config.json has demoMode=false.

RUN:
  pip install flask
  python attendance_server.py
It listens on 0.0.0.0:5000. The Android EMULATOR reaches your PC at 10.0.2.2:5000.

Point the app at it: in src/config/sync.config.json set
  "demoMode": false,
  "awsEndpoint": "http://10.0.2.2:5000/attendance"
(and add the Android cleartext config — see ANDROID_CLEARTEXT.md)
"""
from flask import Flask, request, jsonify
from datetime import datetime
import json, os

app = Flask(__name__)
STORE = os.path.join(os.path.dirname(__file__), "received_attendance.jsonl")
seen_ids = set()  # idempotency: ignore duplicate record ids across retries

@app.route("/attendance", methods=["POST"])
def attendance():
    body = request.get_json(silent=True) or {}
    records = body.get("records", [])
    accepted, duplicates = [], []
    with open(STORE, "a") as f:
        for r in records:
            rid = r.get("id")
            if rid in seen_ids:
                duplicates.append(rid); continue
            seen_ids.add(rid)
            r["_received_at"] = datetime.now().isoformat()
            f.write(json.dumps(r) + "\n")
            accepted.append(rid)
    print(f"[server] {datetime.now().strftime('%H:%M:%S')} received {len(records)} record(s) "
          f"-> accepted {len(accepted)}, duplicate {len(duplicates)}")
    for r in records:
        print(f"          - {r.get('name')} ({r.get('personId')}) @ {r.get('ts')}")
    # 200 OK -> app marks these synced and purges them locally
    return jsonify({"ok": True, "accepted": accepted, "duplicates": duplicates}), 200

@app.route("/attendance", methods=["GET"])
def list_all():
    if not os.path.exists(STORE): return jsonify({"count": 0, "records": []})
    rows = [json.loads(l) for l in open(STORE) if l.strip()]
    return jsonify({"count": len(rows), "records": rows})

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"ok": True, "service": "attendance-test-server"}), 200

if __name__ == "__main__":
    print("Attendance test server on http://0.0.0.0:5000  (emulator: http://10.0.2.2:5000)")
    print("POST /attendance | GET /attendance (view all) | GET /health")
    app.run(host="0.0.0.0", port=5000)