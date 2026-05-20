# deploy

## agent-view.service

Systemd unit for the LAN dashboard. Replaces the `nohup ... &` + `.av.pid` pattern so the process restarts automatically after crashes (e.g. unhandled body-parser errors).

Install on services VM:

```sh
sudo cp deploy/agent-view.service /etc/systemd/system/agent-view.service
sudo systemctl daemon-reload
sudo systemctl enable --now agent-view
sudo systemctl status agent-view
journalctl -u agent-view -f
```

Verify:

```sh
curl -s http://192.168.1.68:4317/health
# {"ok":true,"time":...}

curl -s -X POST -H 'Content-Type: application/json' \
  --data '{"bad":"\x"}' http://192.168.1.68:4317/api/events
# {"error":"invalid json"} — process stays up
```
