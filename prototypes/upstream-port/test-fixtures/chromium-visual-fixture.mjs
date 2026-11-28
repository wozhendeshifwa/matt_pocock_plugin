import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

// CDP sends real pointer and keyboard input; page-side
// observations still read the actual rendered controls and computed styles.
export async function runChromiumVisual(html, width, {browser, dir, screenshotsDir}) {
  const profile = path.join(dir, 'pointer-profile');
  const child = spawn(browser, ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--disable-extensions', '--remote-debugging-port=0', '--user-data-dir=' + profile, '--window-size=' + (width + 100) + ',1000', pathToFileURL(html).href], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  let browserLog = '';
  child.stderr.on('data', chunk => { browserLog = (browserLog + chunk.toString()).slice(-8000); });
  let browserFailure;
  // Observe termination before polling for the port. A later once('exit') can
  // miss an early exit, leaving cleanup waiting on an event already delivered.
  const exited = new Promise(resolve => {
    child.once('error', error => {
      browserFailure = new Error('Chromium could not start: ' + error.message);
      resolve();
    });
    child.once('exit', (code, signal) => {
      browserFailure ??= new Error('Chromium exited before browser verification completed: ' + (signal ?? code));
      resolve();
    });
  });
  let socket;
  const pending = new Map();
  let nextId = 0;
  const call = (method, params = {}) => new Promise((resolve,reject) => { const id = ++nextId; pending.set(id,{resolve,reject}); socket.send(JSON.stringify({id,method,params})); });
  try {
    let port;
    const startup = performance.now();
    for (let i=0;i<600;i++) {
      if (browserFailure) throw browserFailure;
      try { port = Number((await readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]); break; }
      catch { await new Promise(r=>setTimeout(r,50)); }
    }
    if (browserFailure) throw browserFailure;
    assert.ok(port, 'Chromium exposes its local test CDP endpoint (' + browser + ', ' + Math.round(performance.now() - startup) + 'ms): ' + browserLog);
    if (performance.now() - startup >= 5000) console.log('[visual] Chromium startup: ' + Math.round(performance.now() - startup) + 'ms');
    const targets = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
    const target = targets.find(x=>x.type==='page');
    socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
    socket.addEventListener('message',event=>{const m=JSON.parse(event.data);const item=pending.get(m.id);if(item){pending.delete(m.id);m.error?item.reject(new Error(m.error.message)):item.resolve(m.result);}});
    const evaluate = async expression => (await call('Runtime.evaluate',{expression,returnByValue:true})).result.value;
    for (let i=0;i<600;i++) {
      const viewport = await evaluate('window.__viewportRequest || null');
      if (viewport) { await call('Emulation.setDeviceMetricsOverride', {...viewport, deviceScaleFactor:1, mobile:false}); await evaluate('window.__viewportRequest=null;window.__viewportDone();true'); }
      const request = await evaluate('window.__hoverRequest || null');
      if (request) {
        await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:request.x,y:request.y});
        await new Promise(r=>setTimeout(r,80));
        await evaluate('window.__hoverRequest=null;window.__hoverDone();true');
      }
      const screenshot=await evaluate('window.__screenshotRequest || null');
      if(screenshot){if(screenshotsDir){await mkdir(screenshotsDir,{recursive:true});const shot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(path.join(screenshotsDir,screenshot+'.png'),Buffer.from(shot.data,'base64'));}await evaluate('window.__screenshotRequest=null;window.__screenshotDone();true');}
      const keyboard=await evaluate('window.__keyboardRequest || null');
      if (keyboard) {
        await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9,modifiers:keyboard.shift?8:0});
        await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9,modifiers:keyboard.shift?8:0});
        await evaluate('window.__keyboardRequest=null;window.__keyboardDone();true');
      }
      const result = await evaluate('window.__result || null');
      if (result) return result;
      await new Promise(r=>setTimeout(r,25));
    }
    assert.fail('real-pointer production UI test timed out');
  } finally {
    socket?.close();
    if (!browserFailure && child.exitCode === null && child.signalCode === null) child.kill();
    await exited;
  }
}


