// Joins the footage (and the Loose Change review window, shown over the main page while it was open) with
// the presenter's voice into one MP4, and writes the captions as an SRT and a plain transcript.
// Usage: node mux.mjs <out dir> <voice.wav> <audio offset seconds> <final.mp4>
import {execFileSync} from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const [outDir, voice, offsetArg, finalPath] = process.argv.slice(2)
const tl = JSON.parse(fs.readFileSync(path.join(outDir, 'timeline.json'), 'utf8'))
const offset = Math.max(0, Number(offsetArg) || 0)
const main = path.join(outDir, tl.files.main)
const popup = tl.files.popup ? path.join(outDir, tl.files.popup) : null
const dur = tl.total
const ff = (...a) => execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...a], {stdio: 'inherit'})

const inputs = ['-i', main]
let filter = '[0:v]fps=30,format=yuv420p[base]'
let map = '[base]'
if (popup && tl.popup) {
  inputs.push('-i', popup)
  const {start, end} = tl.popup
  filter = `[0:v]fps=30[m];[1:v]fps=30,setpts=PTS-STARTPTS+${start.toFixed(3)}/TB[p];[m][p]overlay=enable='between(t,${start.toFixed(3)},${(end + 0.4).toFixed(3)})':eof_action=pass,format=yuv420p[base]`
}
const audioIdx = popup && tl.popup ? 2 : 1
inputs.push('-ss', offset.toFixed(3), '-i', voice)
ff(...inputs, '-filter_complex', `${filter};[${audioIdx}:a]highpass=f=80,loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000[a]`, '-map', '[base]', '-map', '[a]',
  '-t', dur.toFixed(3), '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', finalPath)

// Captions: each part's sentences spread over the time it takes to read them, from the part's start.
const fmt = s => { const ms = Math.round(s * 1000); const p = (n, w = 2) => String(n).padStart(w, '0'); return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}` }
let n = 1, srt = ''
for (const p of tl.parts) {
  const sentences = p.text.match(/[^.!?]+[.!?]+/g)?.map(s => s.trim()) ?? [p.text]
  const words = sentences.map(s => s.split(/\s+/).length)
  const total = words.reduce((a, b) => a + b, 0)
  const speak = Math.min(p.end - p.start, total / 2.3 + 0.5)
  let t = p.start
  sentences.forEach((s, i) => { const d = (words[i] / total) * speak; srt += `${n++}\n${fmt(t)} --> ${fmt(t + d)}\n${s}\n\n`; t += d })
}
fs.writeFileSync(finalPath.replace(/\.mp4$/, '.srt'), srt)
fs.writeFileSync(finalPath.replace(/\.mp4$/, '.txt'), tl.parts.map(p => p.text).join('\n\n') + '\n')
const length = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', finalPath]).toString())
console.log(`\nVideo: ${finalPath}\nLength: ${length.toFixed(1)} s ${length < 120 ? '(under 2:00, good)' : '(OVER 2:00: record again a bit faster)'}${tl.stub ? '\nTHIS WAS A TEST RUN WITH A SCRIPTED MODEL. DO NOT UPLOAD.' : ''}`)
