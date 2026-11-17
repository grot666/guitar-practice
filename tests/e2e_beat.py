# 节奏训练端到端测试：无头 Chrome + 假麦克风（合成 WAV）
#   python3 tests/e2e_beat.py [URL] [截图目录]
# 需要：playwright（python）、google-chrome；会先起一个本地静态服务器（URL 不给时）
import sys, json, os, subprocess, threading, http.server, functools
from playwright.sync_api import sync_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOT = (sys.argv[2] if len(sys.argv) > 2 else "/workspace/gp-shots").rstrip("/") + "/"
TMP = "/tmp/gp-beat-e2e"; os.makedirs(TMP, exist_ok=True); os.makedirs(SHOT, exist_ok=True)
subprocess.run(["node", os.path.join(ROOT, "tests/e2e_wav.mjs"), TMP], check=True)
if len(sys.argv) > 1 and sys.argv[1].startswith("http"): URL = sys.argv[1]
else:
    h = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT); h.log_message = lambda *a: None
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), h); threading.Thread(target=srv.serve_forever, daemon=True).start()
    URL = f"http://127.0.0.1:{srv.server_address[1]}/"
FAILS = []
def check(cond, msg):
    print(("  ✓ " if cond else "  ✗ ") + msg)
    if not cond: FAILS.append(msg)

def run(wav, fn, vp, mobile, beatcfg=None, setcfg=None):
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream",
            f"--use-file-for-fake-audio-capture={wav}", "--autoplay-policy=no-user-gesture-required"])
        ctx = b.new_context(viewport=vp, is_mobile=mobile, has_touch=mobile, device_scale_factor=2 if mobile else 1, permissions=["microphone"])
        pg = ctx.new_page(); logs = []
        pg.on("pageerror", lambda e: logs.append(f"pageerror: {e}"))
        pg.on("console", lambda m: logs.append(f"{m.type}: {m.text}") if m.type == "error" else None)
        pg.goto(URL)
        pg.evaluate(f"localStorage.setItem('guitar-practice:beat', JSON.stringify({json.dumps(beatcfg or {})}));"
                    f"localStorage.setItem('guitar-practice:settings', JSON.stringify(Object.assign({{checked:{{mic:true,heard:true,click:true}}}}, {json.dumps(setcfg or {})})))")
        pg.goto(URL + "#beat"); pg.reload(); pg.wait_for_timeout(500)
        r = fn(pg)
        b.close()
        check(not logs, "没有页面错误 " + ("; ".join(logs[:3]) if logs else ""))
        return r

DBG = "window.__dbg = window.__dbg || (async()=>{const c=await import('./js/core.js'); const bt=await import('./js/beat.js'); window.__core=c; window.__bt=bt; window.__on=[]; c.onOnset(t=>window.__on.push(t)); return 1;})()"

def internal(tag):
    def fn(pg):
        out = {}
        pg.evaluate(DBG); pg.wait_for_timeout(200)
        pg.screenshot(path=SHOT + f"rhythm-home-{tag}.png", full_page=True)
        out["patterns"] = pg.eval_on_selector_all("#bt-patterns .bt-pc b", "e=>e.map(x=>x.textContent)")
        out["notation_cells"] = pg.eval_on_selector_all("#bt-notation .c", "e=>e.length")
        for m in ["2/4", "3/4", "6/8", "4/4"]:
            pg.click(f"#bt-meter [data-v='{m}']"); pg.wait_for_timeout(80)
            out["n_pat_" + m] = pg.eval_on_selector_all("#bt-patterns .bt-pc", "e=>e.length")
        pg.click("#bt-patterns [data-id='e']")
        pg.click("#mic-chip"); pg.wait_for_timeout(4500)
        # 找到录音里「拍上」那一下的相位（它后面隔 345 ms，后半拍后面隔 255 ms）
        phi = pg.evaluate("(()=>{const o=window.__on, c=[]; for(let i=1;i<o.length-1;i++){if(Math.abs(o[i+1]-o[i]-0.345)<0.02 && Math.abs(o[i]-o[i-1]-0.255)<0.02) c.push(o[i]);} if(c.length<2) return null; const ref=c[c.length-1], d=c.map(t=>{let x=(t-ref)%0.6; if(x>0.3) x-=0.6; if(x<-0.3) x+=0.6; return x;}).sort((a,b)=>a-b); return ref+d[d.length>>1];})()")
        out["phase_found"] = phi is not None
        pg.click("#bt-start")
        pg.wait_for_function("window.__bt.beatDebug() && window.__bt.beatDebug().countStart !== undefined", timeout=5000)
        # 把「设备延迟」设成录音和节拍器之间的固定差（真机上这一步由自动测延迟完成）
        pg.evaluate(f"(()=>{{const r=window.__bt.beatDebug(); let d=({phi}-r.countStart)%0.6; if(d<0) d+=0.6; r.lat=d;}})()")
        pg.wait_for_timeout(2400 + 4200)
        out["live_last"] = pg.inner_text("#bt-last"); out["live_label"] = pg.inner_text("#bt-last-l"); out["state"] = pg.inner_text("#bt-state")
        out["bar_chips_mid"] = pg.eval_on_selector_all("#bt-bars .bc", "e=>e.length")
        pg.screenshot(path=SHOT + f"rhythm-run-{tag}.png", full_page=False) if tag == "phone" else pg.screenshot(path=SHOT + f"rhythm-run-{tag}.png", full_page=True)
        pg.wait_for_selector("#bt-diag:not([hidden])", timeout=30000); pg.wait_for_timeout(700)
        d = pg.evaluate("(()=>{const h=JSON.parse(localStorage.getItem('guitar-practice:history')).slice(-1)[0]; return h;})()")
        out["hist"] = {k: d.get(k) for k in ["type", "pat", "bpm", "bars", "accuracy", "meanMs", "stdMs", "hitRate", "extras"]}
        out["diag_text"] = pg.inner_text("#bt-diag")[:400]
        out["drill_btn"] = pg.is_visible("#bt-drill")
        pg.screenshot(path=SHOT + f"rhythm-diagnosis-{tag}.png", full_page=False)
        if tag == "desktop": pg.screenshot(path=SHOT + f"rhythm-diagnosis-full-{tag}.png", full_page=True)
        out["chips"] = pg.eval_on_selector_all("#bt-bars .bc", "e=>e.map(x=>x.textContent)")
        if out["drill_btn"]:
            pg.click("#bt-drill"); pg.wait_for_timeout(800)
            out["drill"] = {"bpm": pg.inner_text("#bt-bpm"), "pill": pg.inner_text("#bt-focus-pill"), "focus_cells": pg.eval_on_selector_all("#bt-notation .c.focus", "e=>e.length"), "metro_bpm": pg.evaluate("window.__core.metro.bpm")}
            pg.click("#bt-start"); pg.wait_for_timeout(300)
            out["after_stop_running"] = pg.evaluate("!!window.__bt.beatDebug()")
        out["trend"] = pg.inner_text("#bt-trend-t")
        out["overflow"] = pg.evaluate("document.documentElement.scrollWidth - innerWidth")
        # 离开页面时节拍器要停
        pg.click("#bt-start"); pg.wait_for_timeout(500); pg.evaluate("location.hash='#home'"); pg.wait_for_timeout(300)
        out["metro_after_leave"] = pg.evaluate("window.__core.metro.running")
        out["home_tile"] = pg.inner_text("a[href='#beat']")
        return out
    return fn

def external(tag):
    def fn(pg):
        out = {}
        pg.evaluate(DBG); pg.wait_for_timeout(200)
        pg.click("#bt-start")
        pg.wait_for_function("window.__bt.beatDebug() && window.__bt.beatDebug().locked", timeout=15000)
        r = pg.evaluate("(()=>{const r=window.__bt.beatDebug(); return {bpm:r.tracker.grid.bpm, jitter:r.lockInfo.jitterMs, metro:window.__core.metro.running};})()")
        out["lock"] = r
        pg.wait_for_timeout(5200)
        out["live_last"] = pg.inner_text("#bt-last")
        pg.screenshot(path=SHOT + f"rhythm-external-{tag}.png", full_page=(tag == "desktop"))
        pg.wait_for_selector("#bt-diag:not([hidden])", timeout=30000); pg.wait_for_timeout(500)
        pos = pg.evaluate("(()=>{const h=JSON.parse(localStorage.getItem('guitar-practice:history')).slice(-1)[0]; return h;})()")
        out["hist"] = {k: pos.get(k) for k in ["src", "bpm", "accuracy", "meanMs", "stdMs", "hitRate", "extras"]}
        out["pos_means"] = pg.evaluate("window.__bt.lastDiag().positions.map(p=>Math.round(p.meanMs))")
        out["diag_head"] = pg.inner_text("#bt-diag .bt-d-head")
        return out
    return fn

def latency(tag, simulate):
    def fn(pg):
        out = {}
        pg.evaluate(DBG); pg.wait_for_timeout(200)
        if simulate:
            # 无头浏览器没有「喇叭→空气→麦克风」，这里在页面里模拟：播放的测试音延迟 123.4 ms、衰减到 5% 后混进麦克风数据
            pg.evaluate("""(()=>{const e=window.__core.engine, sched=[]; const pl=e.playSamples.bind(e); e.playSamples=(d,t,v)=>{sched.push([d,t]); return pl(d,t,v);};
              const on=e._onChunk.bind(e); e._onChunk=(data,st)=>{ if(!e.ctx) return on(data,st); const sr=e.ctx.sampleRate, out=new Float32Array(data);
                for(const [d,t] of sched){const off=Math.round((t+0.1234-st)*sr); if(off>out.length||off+d.length<0) continue; for(let i=0;i<d.length;i++){const j=off+i; if(j>=0&&j<out.length) out[j]+=0.05*d[i];}} on(out,st);};})()""")
        pg.click("#open-settings"); pg.wait_for_timeout(300)
        pg.click("#s-mic"); pg.wait_for_timeout(1500)
        pg.evaluate("document.querySelector('#s-lat-sec').scrollIntoView({block:'start'})")
        pg.click("#s-cal"); pg.wait_for_timeout(800)
        pg.wait_for_function("!document.querySelector('#s-cal').disabled", timeout=15000); pg.wait_for_timeout(300)
        out["status"] = pg.inner_text("#s-cal-status"); out["lat"] = pg.inner_text("#s-lat-v"); out["dots"] = pg.eval_on_selector_all("#s-cal-dots span", "e=>e.map(x=>x.textContent)")
        pg.evaluate("document.querySelector('#s-lat-sec').scrollIntoView({block:'start'})"); pg.wait_for_timeout(200)
        if simulate: pg.screenshot(path=SHOT + f"rhythm-latency-{tag}.png")
        if not simulate:
            pg.click("#s-ext"); pg.wait_for_timeout(9000)
            out["ext_status"] = pg.inner_text("#s-ext-status")
            pg.evaluate("document.querySelector('#s-ext-sec').scrollIntoView({block:'start'})"); pg.wait_for_timeout(200)
            pg.screenshot(path=SHOT + f"rhythm-exttest-{tag}.png")
        return out
    return fn

R = {}
INT = {"meter": "4/4", "pat": {"4/4": "e"}, "bars": 8, "ladder": False, "bpm": {"4/4:e": 100}, "src": "internal"}
EXT = {"meter": "4/4", "pat": {"4/4": "q"}, "bars": 4, "src": "external", "extAuto": True}
for tag, vp, mob in [("desktop", {"width": 1280, "height": 900}, False), ("phone", {"width": 390, "height": 844}, True)]:
    print(f"== 内置节拍器 · {tag}")
    o = R[f"internal-{tag}"] = run(f"{TMP}/beat-int.wav", internal(tag), vp, mob, INT)
    print(json.dumps(o, ensure_ascii=False))
    check(o["n_pat_2/4"] >= 7 and o["n_pat_3/4"] >= 7 and o["n_pat_4/4"] >= 10 and o["n_pat_6/8"] == 3, "各拍号的节奏型数量")
    check(o["phase_found"], "录音的相位找到了")
    check(o["live_last"] not in ("—", "多弹") and ("ms" in o["live_last"] or o["live_last"] == "正好"), "实时显示每一下早晚：" + o["live_last"])
    h = o["hist"]
    check(h["type"] == "beat" and h["bars"] == 8 and h["hitRate"] >= 0.9 and h["extras"] <= 2, f"8 小节、命中率 {h['hitRate']:.2f}、多弹 {h['extras']}")
    check(15 < h["meanMs"] < 30, f"平均偏差约 +22 ms（拍上 0、后半拍 +45）：{h['meanMs']:.1f}")
    check("每拍后半" in o["diag_text"], "诊断：问题集中在「每拍后半」")
    check(o["drill_btn"] and o.get("drill", {}).get("bpm") == "85" and o["drill"]["focus_cells"] == 4 and o["drill"]["metro_bpm"] == 85, "专项练习：85 BPM、焦点格高亮")
    check(o["overflow"] <= 0, "没有横向溢出")
    check(not o["metro_after_leave"], "离开页面后节拍器停止")
    print(f"== 外部节拍器 · {tag}")
    o = R[f"external-{tag}"] = run(f"{TMP}/beat-ext.wav", external(tag), vp, mob, EXT)
    print(json.dumps(o, ensure_ascii=False))
    check(abs(o["lock"]["bpm"] - 96) < 0.5 and not o["lock"]["metro"], f"锁定 96 BPM、内置节拍器不响：{o['lock']['bpm']:.2f}")
    pm = sorted(o["pos_means"])
    check(len(pm) == 4 and abs(pm[0] + 30) <= 8 and abs(pm[1]) <= 8 and abs(pm[2] - 40) <= 8 and abs(pm[3] - 60) <= 8, f"按外部网格还原四拍的偏差 0/−30/+40/+60：{o['pos_means']}")
    check(o["hist"]["src"] == "external" and o["hist"]["hitRate"] >= 0.9 and o["hist"]["extras"] <= 1, "外部模式：命中率、节拍器声没被当成拨弦")
    print(f"== 设置：自动测延迟 / 外部节拍器测试 · {tag}")
    o = R[f"latency-{tag}"] = run(f"{TMP}/room.wav", latency(tag, True), vp, mob)
    print(json.dumps(o, ensure_ascii=False))
    check(o["lat"] in ("123", "124") and "已采用" in o["status"], "模拟回环 123.4 ms → " + o["lat"])
    o = R[f"latency-fail-{tag}"] = run(f"{TMP}/beat-clicks.wav", latency(tag, False), vp, mob)
    print(json.dumps(o, ensure_ascii=False))
    check("没听清" in o["status"] and o["lat"] == "0", "听不到测试音 → 不改延迟、给出建议")
    import re; mm = re.search(r"测到 ([0-9.]+) BPM", o["ext_status"]); check(mm and abs(float(mm.group(1)) - 96) < 0.6, "外部节拍器测试：" + o["ext_status"][:60])
print("\n" + ("✗ %d 项失败" % len(FAILS) if FAILS else "✓ 节奏训练端到端全部通过"))
sys.exit(1 if FAILS else 0)
