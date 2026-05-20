# agent-view deploy

## systemd install (on svc VM, as root)

```
sudo cp /home/svc/agent-view/deploy/agent-view.service /etc/systemd/system/agent-view.service
sudo systemctl daemon-reload
sudo systemctl enable --now agent-view.service
sudo systemctl status agent-view.service
```

## Replaces

The old `nohup node src/server.js > .av.log 2>&1 &` + `.av.pid` pattern. Kill any
existing process before enabling the unit:

```
pkill -f 'node .*src/server.js' || true
rm -f /home/svc/agent-view/.av.pid
```

## Verify

```
curl -fsS http://192.168.1.68:4317/health
curl -fsS -X POST http://192.168.1.68:4317/api/events \
  -H 'content-type: application/json' --data '{bad json'
# expect HTTP 400 {"error":"invalid json"} and process still up
systemctl is-active agent-view
```
