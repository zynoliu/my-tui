import { mkdir } from "node:fs/promises"
import { resolve } from "node:path"
import { parseArgs } from "node:util"

const { values } = parseArgs({ options: {
  scenario: { type: "string" }, server: { type: "string" }, cols: { type: "string" }, rows: { type: "string" },
  "evidence-dir": { type: "string" },
} })
const scenario = values.scenario
if (!["navigation", "lifecycle", "attention", "responsive"].includes(scenario)) throw new Error("Choose a known --scenario")
if (!values.server || !values["evidence-dir"] || !process.env.OPENCODE_PASSWORD || !process.env.ULW_RUN_TMP || !process.env.ULW_XTERM_DIR) {
  throw new Error("Set --server, --evidence-dir, OPENCODE_PASSWORD, ULW_RUN_TMP and ULW_XTERM_DIR")
}
const root = resolve(import.meta.dir, "../..")
const evidence = resolve(root, values["evidence-dir"])
const cols = Number(values.cols ?? 140)
const rows = Number(values.rows ?? 46)
await mkdir(evidence, { recursive: true })
const auth = `Basic ${btoa(`opencode:${process.env.OPENCODE_PASSWORD}`)}`
const apiLog = Bun.file(`${evidence}/api.jsonl`).writer()
const eventsLog = Bun.file(`${evidence}/events.jsonl`).writer()
const inputLog = Bun.file(`${evidence}/actions.jsonl`).writer()
const rawLog = Bun.file(`${evidence}/terminal.ansi`).writer()
const started = Date.now()
const sockets = new Set()
const events = []
const waiters = new Set()
let generation = 0
let history = ""
let proc
let fault
let finished = false
let permissionRequest
const eventAbort = new AbortController()
const decoder = new TextDecoder()
const eventDecoder = new TextDecoder()

async function api(method, path, body) {
  const response = await fetch(new URL(path, values.server), {
    method, headers: { authorization: auth, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await response.text()
  const entry = { at: Date.now(), method, path, body, status: response.status, headers: Object.fromEntries(response.headers), response: text }
  apiLog.write(`${JSON.stringify(entry)}\n`)
  return { ...entry, json: text && response.headers.get("content-type")?.includes("json") ? JSON.parse(text) : undefined }
}
function must(result) {
  if (result.status >= 400) throw new Error(`${result.method} ${result.path}: ${result.status} ${result.response}`)
  return result.json
}
function waitForEvent(type, sessionID) {
  const matches = (event) => event.type === type && (!sessionID || (event.type === "form.created" ? event.data.form.sessionID : event.data.sessionID) === sessionID)
  const prior = events.find(matches)
  if (prior) return Promise.resolve(prior)
  return new Promise((resolve, reject) => {
    const waiter = { matches, resolve: (value) => { clearTimeout(timeout); waiters.delete(waiter); resolve(value) } }
    const timeout = setTimeout(() => { waiters.delete(waiter); reject(new Error(`Event timeout: ${type} ${sessionID}`)) }, 30000)
    waiters.add(waiter)
  })
}
const eventResponse = await fetch(new URL("/api/event", values.server), { headers: { authorization: auth }, signal: eventAbort.signal })
if (!eventResponse.ok || !eventResponse.body) throw new Error(`Event subscription: ${eventResponse.status}`)
const eventPump = (async () => {
  let buffer = ""
  for await (const chunk of eventResponse.body) {
    buffer += eventDecoder.decode(chunk, { stream: true })
    const frames = buffer.split(/\r?\n\r?\n/)
    buffer = frames.pop() ?? ""
    for (const frame of frames) {
      const payload = frame.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n")
      if (!payload) continue
      const event = JSON.parse(payload)
      events.push(event)
      eventsLog.write(`${JSON.stringify(event)}\n`)
      for (const waiter of waiters) if (waiter.matches(event)) waiter.resolve(event)
    }
  }
})()
await waitForEvent("server.connected")

const second = `${process.env.ULW_RUN_TMP}/project-two`
await mkdir(second, { recursive: true })
await Bun.$`git -C ${second} init -q`.env({ ...process.env, GIT_MASTER: "1" })
const create = async (title, directory = root, extra = {}) => must(await api("POST", "/api/session", {
  title, location: { directory }, model: { providerID: "ollama", id: "qwen25-3b:latest" }, ...extra,
})).data
const seed = {
  scenario, main: await create(`ULW ${scenario} 主会话`),
  other: await create(`ULW ${scenario} second project`, second),
  target: await create(`ULW ${scenario} lifecycle target`),
}
if (scenario === "attention") {
  seed.question = await create("ULW question pending")
  seed.permission = await create("ULW permission pending", root, {
    permissions: [{ action: "ulw.review", resource: "*", effect: "ask" }],
  })
  const requested = waitForEvent("form.created", seed.question.id)
  seed.form = must(await api("POST", `/api/session/${seed.question.id}/form`, {
    title: "ULW question: choose navigation", fields: [{ key: "answer", type: "string" }],
  })).data
  await requested
  const permissionPending = waitForEvent("permission.asked", seed.permission.id)
  permissionRequest = api("POST", `/api/session/${seed.permission.id}/permission`, {
    action: "ulw.review", resources: [`${root}/README.md`], save: [], metadata: {},
  })
  await permissionPending
  seed.pendingPermissions = must(await api("GET", `/api/session/${seed.permission.id}/permission`)).data
}
await Bun.write(`${evidence}/seed.json`, JSON.stringify(seed, null, 2))

function broadcast(message) { for (const socket of sockets) socket.send(JSON.stringify(message)) }
function startTerminal() {
  generation++
  history = ""
  decoder.decode()
  broadcast({ type: "reset", generation })
  proc = Bun.spawn([process.execPath, "run", "dev", "--", "--server", server.url.href, "--session", seed.main.id], {
    cwd: root,
    env: { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor", OPENCODE_TUI_CHANNEL: "dev" },
    terminal: {
      cols, rows,
      data(_terminal, bytes) {
        rawLog.write(bytes)
        const data = decoder.decode(bytes, { stream: true })
        history += data
        broadcast({ type: "output", data, generation })
      },
    },
  })
  inputLog.write(`${JSON.stringify({ type: "launch", generation, pid: proc.pid, cols, rows, sessionID: seed.main.id })}\n`)
}
async function stopTerminal() {
  if (!proc) return
  proc.kill("SIGTERM")
  const code = await proc.exited
  proc.terminal?.close()
  inputLog.write(`${JSON.stringify({ type: "terminal-exit", pid: proc.pid, code })}\n`)
}
const html = `<!doctype html><html><head><link rel="stylesheet" href="/xterm/css/xterm.css">
<style>html,body{margin:0;background:#15181c}.xterm{padding:0}</style></head><body><div id="terminal"></div>
<script src="/xterm/lib/xterm.js"></script><script>
const term=window.term=new Terminal({cols:${cols},rows:${rows},fontSize:14,fontFamily:"Menlo,monospace",theme:{background:"#15181c"}});
term.open(document.getElementById("terminal"));
const ws=new WebSocket("ws://"+location.host+"/socket");const checks=new Set();
const text=()=>Array.from({length:term.rows},(_,i)=>term.buffer.active.getLine(i)?.translateToString(true)??"").join("\\n");
const check=()=>{for(const c of checks)if(c.predicate())c.resolve(text())};
term.onWriteParsed(check);
window.qa={generation:0,text,seed:${JSON.stringify(seed, (_, value) => value instanceof Promise ? undefined : value)},
 ready:new Promise(resolve=>ws.addEventListener("open",resolve,{once:true})),
 send:data=>ws.send(data),mouse:(button,x,y)=>ws.send("\\x1b[<"+button+";"+(x+1)+";"+(y+1)+"M\\x1b[<"+button+";"+(x+1)+";"+(y+1)+"m"),
 until:(predicate,timeout=30000)=>new Promise((resolve,reject)=>{let timer;const c={predicate,resolve:v=>{clearTimeout(timer);checks.delete(c);resolve(v)}};checks.add(c);timer=setTimeout(()=>{checks.delete(c);reject(new Error("Frame predicate timed out"))},timeout);check()}),
 api:async(method,path,body)=>{const r=await fetch("/qa-api",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({method,path,body})});return r.json()},
 record:async(name,extra={})=>fetch("/record",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({name,transcript:text(),generation:qa.generation,...extra})}),
 finish:async(pass)=>fetch("/finish",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({pass,transcript:text()})})};
ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.type==="reset"){term.reset();qa.generation=m.generation;check();return}qa.generation=m.generation;term.write(m.data)};
term.onData(data=>ws.send(data));
</script></body></html>`
const server = Bun.serve({
  hostname: "127.0.0.1", port: 0,
  async fetch(request, host) {
    const url = new URL(request.url)
    if (url.pathname === "/xterm/lib/xterm.js" || url.pathname === "/xterm/css/xterm.css") {
      return new Response(Bun.file(`${process.env.ULW_XTERM_DIR}/${url.pathname.slice(7)}`))
    }
    if (url.pathname === "/socket" && host.upgrade(request)) return
    if (url.pathname === "/") return new Response(html, { headers: { "content-type": "text/html" } })
    if (url.pathname === "/seed") return Response.json(seed)
    if (url.pathname === "/raw") return new Response(history)
    if (url.pathname === "/qa-api") {
      const input = await request.json()
      return Response.json(await api(input.method, input.path, input.body))
    }
    if (url.pathname === "/fault") { fault = await request.json(); return Response.json({ armed: fault }) }
    if (url.pathname === "/restart") { await stopTerminal(); startTerminal(); return Response.json({ generation, pid: proc.pid }) }
    if (url.pathname === "/record") {
      const record = await request.json()
      await Bun.write(`${evidence}/${record.name}.txt`, record.transcript)
      inputLog.write(`${JSON.stringify({ type: "checkpoint", ...record, transcript: undefined })}\n`)
      return Response.json({ saved: record.name })
    }
    if (url.pathname === "/finish" && !finished) {
      finished = true
      const result = await request.json()
      await Bun.write(`${evidence}/final.txt`, result.transcript)
      await stopTerminal()
      for (const permission of seed.pendingPermissions ?? []) await api("POST", `/api/session/${seed.permission.id}/permission/${permission.id}/reply`, { decision: "reject" })
      if (permissionRequest) await permissionRequest
      eventAbort.abort()
      await eventPump.catch((error) => { if (error.name !== "AbortError") throw error })
      await Promise.all([apiLog.end(), eventsLog.end(), inputLog.end(), rawLog.end()])
      await Bun.write(`${evidence}/result.json`, JSON.stringify({ pass: result.pass, scenario, elapsed: Date.now() - started, terminalPID: proc.pid, port: host.port }, null, 2))
      console.log(`QA_FINISHED ${JSON.stringify({ pass: result.pass, scenario, terminalPID: proc.pid, port: host.port })}`)
      setImmediate(() => { host.stop(true); process.exit(result.pass ? 0 : 1) })
      return Response.json({ finished: true })
    }
    if (url.pathname.startsWith("/api/")) {
      const headers = new Headers(request.headers)
      if (fault?.method === request.method && fault.path === url.pathname) { headers.delete("authorization"); fault = undefined }
      const body = ["GET", "HEAD"].includes(request.method) ? undefined : await request.arrayBuffer()
      const response = await fetch(new URL(url.pathname + url.search, values.server), { method: request.method, headers, body })
      if (url.pathname !== "/api/event") {
        const copy = response.clone()
        void copy.text().then((text) => apiLog.write(`${JSON.stringify({ type: "tui-api", method: request.method, path: url.pathname + url.search, status: response.status, headers: Object.fromEntries(response.headers), response: text })}\n`))
      }
      const outgoing = new Headers(response.headers)
      outgoing.delete("content-encoding")
      outgoing.delete("content-length")
      outgoing.delete("transfer-encoding")
      return new Response(response.body, { status: response.status, headers: outgoing })
    }
    return new Response("Not found", { status: 404 })
  },
  websocket: {
    open(socket) { sockets.add(socket); socket.send(JSON.stringify({ type: "output", data: history, generation })) },
    message(_socket, message) { inputLog.write(`${JSON.stringify({ type: "input", data: message })}\n`); proc?.terminal?.write(message) },
    close(socket) { sockets.delete(socket) },
  },
})
startTerminal()
await Bun.write(`${evidence}/runtime.json`, JSON.stringify({ url: server.url.href, port: server.port, terminalPID: proc.pid, scenario }))
console.log(`QA_READY ${JSON.stringify({ url: server.url.href, port: server.port, terminalPID: proc.pid, scenario, evidence })}`)
