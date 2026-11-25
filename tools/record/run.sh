#!/bin/bash
# One command to make the demo video:  bash tools/record/run.sh
# It asks for your Gemini key (hidden), starts the two local sites, records the screen footage in a headless
# browser, records YOUR voice from the microphone while you read the text printed in this terminal, and joins
# everything into ~/Desktop/loose-change-agent-demo.mp4 (plus .srt captions and a .txt transcript).
# Add --stub for a pipeline test with a scripted model (never upload that).
cd "$(dirname "$0")/../.." || exit 1
ROOT=$(pwd)
OUT="$ROOT/_record"
STUB=0; [ "$1" = "--stub" ] && STUB=1
FINAL="$HOME/Desktop/loose-change-agent-demo.mp4"; [ $STUB = 1 ] && FINAL="$OUT/TEST-loose-change-agent-demo.mp4"
mkdir -p "$OUT"
PIDS=()
cleanup() { for p in "${PIDS[@]}"; do kill "$p" 2>/dev/null; done; [ -n "$FFPID" ] && kill -INT "$FFPID" 2>/dev/null; }
trap cleanup EXIT

echo "== Loose Change agent: demo video =="
if [ $STUB = 0 ]; then
  printf "Paste your Gemini API key and press Enter (it stays hidden and is not saved): "
  read -rs LC_GEMINI_KEY; echo
  [ -z "$LC_GEMINI_KEY" ] && { echo "No key. Stopping."; exit 1; }
  export LC_GEMINI_KEY
fi

# microphone: pick the first audio device and check that it really records sound
LIST=$(ffmpeg -hide_banner -f avfoundation -list_devices true -i "" 2>&1 | awk '/AVFoundation audio devices/{a=1;next} a&&/\[[0-9]+\] /{print}')
DEV=$(echo "$LIST" | grep -i "macbook.*microphone" | head -1 | sed -E 's/.*\[([0-9]+)\] .*/\1/')
[ -z "$DEV" ] && DEV=$(echo "$LIST" | head -1 | sed -E 's/.*\[([0-9]+)\] .*/\1/')
[ -z "$DEV" ] && DEV=0
echo "Microphone used: $(echo "$LIST" | grep "\[$DEV\] " | sed -E 's/.*\] //')"
[ -z "$DEV" ] && DEV=0
if [ $STUB = 0 ]; then
  echo "Microphone test: say a few words now (3 seconds)…"
  ffmpeg -y -hide_banner -loglevel error -f avfoundation -i ":$DEV" -t 3 -ac 1 "$OUT/mic-test.wav"
  LEVEL=$(ffmpeg -hide_banner -i "$OUT/mic-test.wav" -af volumedetect -f null - 2>&1 | awk '/mean_volume/{print $5}')
  echo "Microphone level: ${LEVEL:-none} dB"
  if [ -z "$LEVEL" ] || awk "BEGIN{exit !(${LEVEL:--99} < -60)}"; then
    echo "The microphone recorded silence. Open System Settings > Privacy & Security > Microphone, allow Terminal, then run this command again."
    exit 1
  fi
fi

# the two sites
( cd "$ROOT" && npm run build >/dev/null 2>&1 && node tools/demo-local.ts >/dev/null 2>&1 ) || { echo "Build failed. Run 'npm install' first."; exit 1; }
up() { curl -s -o /dev/null --max-time 2 "$1"; }
up http://127.0.0.1:8080/ || { node tools/agentify-skill/scripts/serve_site.mjs site --port 8080 >/dev/null 2>&1 & PIDS+=($!); }
up http://127.0.0.1:8081/ || { node tools/agentify-skill/scripts/serve_site.mjs _local-demo/pocketbook --port 8081 >/dev/null 2>&1 & PIDS+=($!); }
sleep 2

# voice recording starts first so that nothing you say is lost
VOICE="$OUT/voice.wav"
if [ $STUB = 1 ]; then
  ffmpeg -y -hide_banner -loglevel error -f lavfi -i "sine=frequency=220:duration=200" -ac 1 -ar 44100 "$VOICE" &
else
  ffmpeg -y -hide_banner -loglevel error -f avfoundation -i ":$DEV" -ac 1 -ar 44100 "$VOICE" &
fi
FFPID=$!
A0=$(python3 -c 'import time;print(time.time())')
sleep 1.5

if [ $STUB = 1 ]; then node tools/record/record.mjs "$OUT" --stub --no-wait; else node tools/record/record.mjs "$OUT"; fi
RC=$?
T0=$(python3 -c 'import json;print(json.load(open("'"$OUT"'/timeline.json"))["clock0"]/1000)' 2>/dev/null)
kill -INT "$FFPID" 2>/dev/null; wait "$FFPID" 2>/dev/null; FFPID=""
[ $RC -ne 0 ] && { echo "The footage failed (see the message above). Nothing was uploaded or published. Run the command again."; exit $RC; }
OFFSET=$(python3 -c "print(max(0, $T0 - $A0 + 0.35))")
node tools/record/mux.mjs "$OUT" "$VOICE" "$OFFSET" "$FINAL" || exit 1
echo "Done. Watch it once before uploading."
