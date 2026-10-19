const { tabElement, viewId } = require('./window-view-fixtures.cjs');
// External CDP + native Windows UI automation of the unmodified, fused EXE.
// Nothing is injected into main/preload/ASAR. No test switch ships in the app.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const { verifyPackage, verifyZip, packageDirectory, zipFile } = require('./verify-artifacts.cjs');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reader-packaged-'));
const report = { root, starts: [], checks: [], helpers: [] };
let current;
function tables(file) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 14);
    assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    return Object.fromEntries(db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
      .map(({name}) => [name, db.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all().map(row=>({...row}))]));
  } finally { db.close(); }
}
async function command(executable, args, options = {}) {
  const child = spawn(executable, args, { windowsHide: true, ...options });
  let output = '';
  child.stdout?.on('data', data => { output += data; }); child.stderr?.on('data', data => { output += data; });
  await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${executable} exit ${code}: ${output}`))); });
  return output;
}
async function connect(url) {
  const socket = new WebSocket(url), pending = new Map(), contexts=[]; let id = 0;
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  socket.onmessage = ({data}) => {
    const message = JSON.parse(data), waiter = pending.get(message.id);
    if (message.method==='Runtime.executionContextCreated') contexts.push(message.params.context);
    if (waiter) { clearTimeout(waiter.timeout); pending.delete(message.id); message.error ? waiter.reject(new Error(JSON.stringify(message.error))) : waiter.resolve(message.result); }
  };
  socket.onclose = () => { for (const waiter of pending.values()) { clearTimeout(waiter.timeout); waiter.reject(new Error('CDP closed')); } pending.clear(); };
  return { socket, contexts, send: (method, params = {}) => new Promise((resolve, reject) => {
    const key = ++id, timeout = setTimeout(() => { pending.delete(key); reject(new Error(`CDP timeout ${method}`)); }, 180000);
    pending.set(key, {resolve,reject,timeout}); socket.send(JSON.stringify({id:key,method,params}));
  }) };
}
async function attach(profile, started, label, targetId, ownedViewId) {
  const active = path.join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 500; i++) {
    try {
      const port = fs.readFileSync(active, 'utf8').split('\n')[0];
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const target = targets.find(target=>target.type==='page' && target.url.startsWith('file:') && (!targetId || target.id===targetId));
      if (!target) throw new Error('No renderer');
      const cdp = await connect(target.webSocketDebuggerUrl);
      const js = async expression => {
        const result = await cdp.send('Runtime.evaluate', {expression,awaitPromise:true,returnByValue:true,userGesture:true});
        if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
        return result.result.value;
      };
      if (!await js("!!document.querySelector('.app-shell')")) { cdp.socket.close(); throw new Error('Not ready'); }
      if (ownedViewId && !await js('window.reader.bootstrap().then(r=>!!r.value.viewInstances['+JSON.stringify(ownedViewId)+'])')) {
        cdp.socket.close();
        const remaining=targets.filter(t=>t.id!==target.id&&t.type==='page'&&t.url.startsWith('file:'));
        for(const candidate of remaining) {
          const other=await attach(profile,started,label,candidate.id);
          if(await other.js('window.reader.bootstrap().then(r=>!!r.value.viewInstances['+JSON.stringify(ownedViewId)+'])')) return other;
          other.cdp.socket.close();
        }
        throw new Error('Owned window not ready');
      }
      const browser = await connect((await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()).webSocketDebuggerUrl);
      const processes = await browser.send('SystemInfo.getProcessInfo'); browser.socket.close();
      const pid = processes.processInfo.find(p=>p.type==='browser').id;
      report.starts.push({ label, milliseconds: Math.round(performance.now()-started), pid, url:target.url });
      const session = {cdp,js,pid,profile,port,targetId:target.id};
      current = session;
      session.wait = async expression => {
        for (let i=0;i<400;i++) { if (await js(expression)) return; await pause(40); }
        throw new Error(`Timed out ${expression}; ${await js('document.body.innerText')}`);
      };
      session.invoke = async (method,payload) => {
      // Capture the acknowledged descriptor/state before this sequential test intent.
      if (method === 'toggleSeen' || method === 'undoSeen') {
        const acknowledged = await session.js(`window.reader.getSharedSnapshot(${JSON.stringify({itemId:payload.itemId})}).then(r=>r.value)`);
        payload = method === 'toggleSeen' ? { ...payload, seen: !acknowledged.comments.find(c=>c.id===payload.commentId).seen }
          : { ...payload, expectedOperationId: acknowledged.undo.id };
      }
        const result = await js(`window.reader.${method}(${payload===undefined?'':JSON.stringify(payload)})`);
        assert.equal(result.ok,true,JSON.stringify(result)); return result.value;
      };
      return session;
    } catch (error) { if(i===499) throw error; await pause(40); }
  }
}
const logDirectory = path.resolve(__dirname, '../.packaging-diagnostics');
fs.mkdirSync(logDirectory, {recursive:true});
async function start(executable, environment, profile, label, developmentEntry, ownedViewId) {
  fs.rmSync(path.join(profile,'DevToolsActivePort'),{force:true});
  const started = performance.now();
  const child = spawn(executable,[...(developmentEntry?[developmentEntry]:[]),'--remote-debugging-address=127.0.0.1','--remote-debugging-port=0'],{cwd:root,env:environment,windowsHide:true,stdio:['ignore','pipe','pipe']});
  const log = fs.createWriteStream(path.join(logDirectory,`packaged-${label}.log`));
  child.stdout.pipe(log); child.stderr.pipe(log);
  const session = await attach(profile,started,label,undefined,ownedViewId); session.child=child;
  assert.match(await session.js('location.href'),developmentEntry?/\.vite/:/app\.asar/);
  assert.equal(await session.js("[typeof require,typeof process,typeof Buffer].join(',')"),'undefined,undefined,undefined');
  assert.equal(await session.js('Object.isFrozen(window.reader)'),true);
  await session.cdp.send('Runtime.enable');
  const isolated=session.cdp.contexts.find(context=>context.name==='Electron Isolated Context');
  assert.ok(isolated,'Separate preload context');
  const security=await session.cdp.send('Runtime.evaluate',{contextId:isolated.id,expression:'[typeof process,typeof require].join(",")',returnByValue:true});
  assert.equal(security.result.value,'undefined,undefined','Sandboxed preload has no ambient Node globals');
  report.runtime={isolatedPreloadContext:true,rendererNodeGlobals:false,userAgent:await session.js('navigator.userAgent')};
  assert.equal(await session.js("['invoke','exec','readFile','openExternal','spawn','selectExecutable'].some(key=>key in window.reader)"),false);
  for (const [method,payload] of [['openSource',{itemId:'x',url:'https://example.com'}],
    ['openCommentAction',{itemId:'x',commentId:'y',action:'translate',url:'https://example.com'}],
    ['openCommentAction',{itemId:'x',commentId:'y',action:'translate',translationTarget:'de'}],
    ['chooseHelper',{kind:'yt-dlp',path:'evil.exe'}]])
    assert.deepEqual(await session.js(`window.reader.${method}(${JSON.stringify(payload)})`),{ok:false,error:{code:'INVALID_REQUEST'}});
  return session;
}
async function close(session) {
  await closeNativeWindow(session);
  if (session.child) await new Promise((resolve,reject)=>{
    if(session.child.exitCode!==null) { assert.equal(session.child.exitCode,0);resolve();return; }
    const timer=setTimeout(()=>reject(new Error('Clean shutdown timeout')),15000);
    session.child.once('exit',code=>{clearTimeout(timer);code===0?resolve():reject(new Error(`App exit ${code}`));});
  });
  else {
    let exited=false;
    for(let i=0;i<150;i++) {
      try { process.kill(session.pid,0); } catch(error) { if(error.code==='ESRCH') {exited=true;break;} throw error; }
      await pause(100);
    }
    assert.ok(exited,'Relaunched application shuts down cleanly');
  }
  session.cdp.socket.close(); current=undefined; await pause(200);
}
async function closePeer(peer) {
  await closeNativeWindow(peer);
  for(let i=0;i<300;i++) {
    const targets=await(await fetch(`http://127.0.0.1:${peer.port}/json/list`)).json();
    if(!targets.some(t=>t.id===peer.targetId)) { peer.cdp.socket.close(); return; }
    await pause(25);
  }
  throw new Error('Packaged peer did not close: '+JSON.stringify(await peer.js('window.reader.lifecycle.current()')));
}
async function closeNativeWindow(session) {
  const title='Disposable packaged Close '+session.targetId;
  await session.js('document.title='+JSON.stringify(title));
  console.log(await command('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'packaged-native-dialog.ps1'),'-ApplicationPid',String(session.pid),'-Action','close-window','-WindowTitle',title]));
}
async function native(session, action, file) {
  console.log(`Native ${action}: PID ${session.pid}`);
  console.log(await command('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'packaged-native-dialog.ps1'),'-ApplicationPid',String(session.pid),'-Action',action,...(file?['-FilePath',path.normalize(file)]:[])]));
}
async function control(session,selector,value) {
  await session.js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}); Object.getOwnPropertyDescriptor(e instanceof HTMLSelectElement?HTMLSelectElement.prototype:HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)}); e.dispatchEvent(new Event(e instanceof HTMLSelectElement?'change':'input',{bubbles:true}));})()`);
  await pause(80);
}
async function apply(session) {
  await session.js("document.querySelector('[role=tabpanel]:not([hidden]) .query-controls').requestSubmit()");
  await pause(150);
  await session.wait("!document.querySelector('.query-error') && !document.querySelector('[role=tabpanel]:not([hidden]) .query-status').textContent.includes('Evaluating')");
}
function seed(file) {
  // App is closed. Fixture tools execute in the test runner, never in the package.
  const toolsFile=path.join(root,'fixture-tools.cjs');
  require('esbuild').buildSync({stdin:{contents:`export {ReaderRepository} from ${JSON.stringify(path.resolve(__dirname,'../src/main/persistence/reader-repository.ts'))};export {normalizeYtDlp} from ${JSON.stringify(path.resolve(__dirname,'../src/main/extractors/yt-dlp.ts'))};`,resolveDir:path.resolve(__dirname,'..'),loader:'ts'},bundle:true,platform:'node',format:'cjs',outfile:toolsFile});
  const tools=require(toolsFile), repo=tools.ReaderRepository.open(file);
  try {
    const fixture=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../src/main/extractors/__fixtures__/yt-nested-a.json'),'utf8'));
    const baseline={...fixture.raw,comments:[...fixture.raw.comments,...Array.from({length:250},(_,i)=>({id:`packaged-virtual-${i}`,parent:'root',text:`Packaging virtual row ${i}: ${'Zażółć gęślą jaźń. '.repeat(1+i%5)}`,timestamp:1790856000}))]};
    const normalized=tools.normalizeYtDlp(JSON.stringify(baseline),fixture.context);
    const initial=repo.ingest(normalized,undefined,true);
    const later={...baseline,comments:[...baseline.comments,{id:'packaged-new',parent:'root',text:'Packaged worker target Polish zażółć',timestamp:1790856000}]};
    repo.ingest(tools.normalizeYtDlp(JSON.stringify(later),fixture.context),undefined,true);
    repo.setDiscussionCollapse({viewId:viewId(repo.bootstrap(['en']),initial.itemId),expectedRevision:0,kind:'all',collapsed:true});
    const rootComment=repo.bootstrap(['en']).comments[initial.itemId].find(comment=>comment.parentId===null);
    assert.ok(rootComment);
    repo.setDiscussionCollapse({viewId:viewId(repo.bootstrap(['en']),initial.itemId),expectedRevision:1,kind:'comments',ids:[rootComment.id],collapsed:false});
    const primaryViewId=viewId(repo.bootstrap(['en']),initial.itemId);
    for(let i=0;i<2;i++) { const id=repo.createPersistentWindow(); for(const name of ['openLibrary','openSettings','openStoredItem']) repo.changeWorkspace(name,name==='openStoredItem'?initial.itemId:undefined,undefined,id); }
    fs.writeFileSync(path.join(root,'native-identities.json'),JSON.stringify({primaryViewId}));
    return initial.itemId;
  } finally {repo.close();}
}
async function run() {
  assert.equal(process.platform,'win32');
  await verifyPackage(); await verifyZip();
  const extracted=path.join(root,'extracted application');
  fs.mkdirSync(extracted);
  await require('extract-zip')(zipFile,{dir:extracted});
  await verifyPackage(extracted);
  const executable=path.join(extracted,'youtube-comments.exe');
  const environment={...process.env};
  for(const key of ['ELECTRON_RUN_AS_NODE','NODE_OPTIONS','YOUTUBE_COMMENTS_DEMO_ROOT','YOUTUBE_COMMENTS_YTDLP_EXE','YOUTUBE_COMMENTS_POST_ARCHIVER_EXE']) delete environment[key];
  const roaming=path.join(root,'Windows profile','AppData','Roaming'), local=path.join(root,'Windows profile','AppData','Local');
  fs.mkdirSync(roaming,{recursive:true}); fs.mkdirSync(local,{recursive:true});
  Object.assign(environment,{APPDATA:roaming,LOCALAPPDATA:local,USERPROFILE:path.dirname(path.dirname(roaming))});
  // The optional installed Python launchers use their existing installation;
  // redirecting the Windows profile must not pretend their modules were bundled.
  environment.PYTHONUSERBASE=process.env.PYTHONUSERBASE || path.join(process.env.APPDATA,'Python');
  for (const folder of ['Desktop','Documents','Downloads']) fs.mkdirSync(path.join(environment.USERPROFILE,folder),{recursive:true});
  const demoRoot=path.join(root,'explicit-demo'), demoProfile=path.join(demoRoot,'youtube-comments-development');
  fs.mkdirSync(demoProfile,{recursive:true});
  let session=await start(executable,{...environment,YOUTUBE_COMMENTS_DEMO_ROOT:demoRoot},demoProfile,'demo');
  assert.equal((await session.invoke('bootstrap')).items.length,2);
  await close(session); report.checks.push('Explicit packaged demo mode seeds only its isolated development profile');
  const profile=path.join(roaming,'youtube-comments-production'), database=path.join(profile,'reader.sqlite');
  fs.mkdirSync(profile,{recursive:true});
  session=await start(executable,environment,profile,'production-fresh');
  assert.equal((await session.invoke('bootstrap')).items.length,0,'Fresh packaged production must not seed demo');
  assert.ok(fs.existsSync(database)); await close(session);
  tables(database); // Check current schema/integrity before adding any fixture.
  report.checks.push('Fresh production schema 14 in independent disposable Windows profile environment; no demo');
  const itemId=seed(database);
  const {primaryViewId}=JSON.parse(fs.readFileSync(path.join(root,'native-identities.json')));
  session=await start(executable,environment,profile,'production-existing',undefined,primaryViewId);
  let boot=await session.invoke('bootstrap'); assert.equal(boot.items.length,1);
  await session.wait("!!document.querySelector('.comment') && !!document.querySelector('.source-button')");
  assert.equal(boot.discussionCollapse[viewId(boot,itemId)].defaultCollapsed,true);
  assert.ok(boot.discussionCollapse[viewId(boot,itemId)].overrides.length>0);
  report.checks.push('Existing schema 14 with sparse collapse default/exception, source header, real ASAR renderer/preload and node:sqlite');
  const panel='[role=tabpanel]:not([hidden])';
  // UI preferences, kept in React as well as persisted in SQLite.
  await session.js("document.getElementById('settings-toggle').click()");
  await session.wait("document.querySelectorAll('.helper-tool[aria-busy=false]').length===2");
  for(const locale of ['pl','en']) {
    await control(session,'.preferences select',locale);
    await session.wait(`document.documentElement.lang===${JSON.stringify(locale)}`);
  }
  for(const appearance of ['light','dark','system']) {
    await session.js(`(()=>{const e=document.querySelectorAll('.preferences select')[1]; e.value=${JSON.stringify(appearance)};e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await session.wait(`document.documentElement.dataset.appearance===${JSON.stringify(appearance)}`);
  }
  assert.equal((await session.invoke('bootstrap')).preferences.translationTarget,'app');
  await session.js("(()=>{const e=document.querySelectorAll('.preferences select')[2];e.value='de';e.dispatchEvent(new Event('change',{bubbles:true}));})()");
  await session.wait("window.reader.bootstrap().then(r=>r.value.preferences.translationTarget==='de')");
  assert.equal((await session.invoke('bootstrap')).preferences.selectionControls,'on-demand');
  assert.equal((await session.invoke('bootstrap')).preferences.includeCollapsedInPrefix,true);
  await session.js("(()=>{const e=document.querySelectorAll('.preferences select')[3];e.value='always';e.dispatchEvent(new Event('change',{bubbles:true}));})()");
  await session.wait("window.reader.bootstrap().then(r=>r.value.preferences.selectionControls==='always')");
  await session.js("document.querySelector('.preferences input[type=checkbox]').click()");
  await session.wait("window.reader.bootstrap().then(r=>r.value.preferences.includeCollapsedInPrefix===false)");
  // Native Cancel exercises the real picker without selecting a test executable.
  const picker=session.invoke('chooseHelper',{kind:'yt-dlp'}); picker.catch(()=>undefined);
  await pause(700);
  await native(session,'cancel'); assert.equal(await picker,null);
  for (const [kind, variable] of [['yt-dlp','PACKAGED_SMOKE_YTDLP_EXE'],['post-archiver','PACKAGED_SMOKE_POST_ARCHIVER_EXE']]) {
    const selected=process.env[variable];
    if (!selected) { report.helpers.push({kind,status:'not configured for optional live smoke'}); continue; }
    const choice=session.invoke('chooseHelper',{kind}); choice.catch(()=>undefined);
    await native(session,'file',selected);
    const status=await choice;
    assert.equal(status.mode,'configured'); assert.ok(['tested','untested'].includes(status.state),JSON.stringify(status));
    report.helpers.push({kind,state:status.state,version:status.version,path:status.path});
  }
  report.checks.push('Library/Settings, EN/PL, System/Light/Dark, two helper statuses and native executable picker');
  await session.js(`${tabElement(itemId)}.click()`);
  await session.wait(`!!document.querySelector('${panel} .comment')`);
  assert.equal(await session.js(`!!document.querySelector('${panel} .creator-author') && !!document.querySelector('${panel} .action-translate button[title]') && !!document.querySelector('${panel} .action-author button[title]')`),true,'Packaged reader exposes trusted creator and discoverable external actions');
  assert.equal(await session.js(`!!document.querySelector('${panel} .action-permalink')`),false,'Sanitized non-YouTube fixture IDs never become fabricated permalinks');
  const before=(await session.invoke('bootstrap')).comments[itemId];
  const target=before.find(c=>c.parentId===null && before.some(child=>child.parentId===c.id)); assert.ok(target);
  await session.js(`Array.from(document.querySelectorAll('[role=tabpanel]:not([hidden]) article.comment')).find(row=>row.dataset.domainCommentId===${JSON.stringify(target.id)}).querySelector('.comment-text').dispatchEvent(new MouseEvent('click',{bubbles:true,button:0,ctrlKey:true,shiftKey:true}))`);
  await pause(100); assert.deepEqual((await session.invoke('bootstrap')).comments[itemId],before,'Former Ctrl+Shift row action never marks');
  await session.js(`Array.from(document.querySelectorAll('[role=tabpanel]:not([hidden]) article.comment')).find(row=>row.dataset.domainCommentId===${JSON.stringify(target.id)}).querySelector('input').dispatchEvent(new MouseEvent('click',{bubbles:true,button:0,ctrlKey:true}))`);
  await session.wait(`window.reader.bootstrap().then(r=>r.value.comments[${JSON.stringify(itemId)}].find(c=>c.id===${JSON.stringify(target.id)}).seen===true)`);
  boot=await session.invoke('bootstrap'); assert.ok(boot.seenUndo[itemId]);
  assert.equal(boot.comments[itemId].filter(c=>c.parentId===target.id).every(c=>c.seen),true);
  await session.js(`Array.from(document.querySelectorAll('[role=tabpanel]:not([hidden]) article.comment')).find(row=>row.dataset.domainCommentId===${JSON.stringify(target.id)}).querySelector('.seen-control input').click()`);
  await session.wait(`window.reader.bootstrap().then(r=>r.value.comments[${JSON.stringify(itemId)}].find(c=>c.id===${JSON.stringify(target.id)}).seen===false)`);
  assert.equal((await session.invoke('bootstrap')).comments[itemId].filter(c=>c.parentId===target.id).every(c=>c.seen),true,'Checkbox changes only its comment');
  // Invalid atomic target cannot partially mutate state.
  const saved=tables(database);
  const invalid=await session.js(`window.reader.bulkSeen(${JSON.stringify({itemId,seen:false,target:{kind:'matching',ids:[target.id,'missing']}})})`);
  assert.equal(invalid.ok,false); assert.deepEqual(tables(database),saved);
  const child=before.find(comment=>comment.parentId===target.id); assert.ok(child);
  for(const id of [target.id,child.id]) await session.js(`Array.from(document.querySelectorAll('[role=tabpanel]:not([hidden]) article.comment')).find(row=>row.dataset.domainCommentId===${JSON.stringify(id)}).querySelector('.selection-circle').click()`);
  await session.js(`Array.from(document.querySelectorAll('${panel} .selection-toolbar button')).find(b=>b.textContent.trim()==='Mark selected unread').click()`);
  await session.wait("!!document.querySelector('dialog[open]')");
  await session.js("document.querySelector('dialog[open] .dialog-actions button:last-child').click()");
  await session.wait(`window.reader.bootstrap().then(r=>r.value.seenUndo[${JSON.stringify(itemId)}]?.kind==='selected')`);
  await session.wait("!document.querySelector('dialog[open]')");
  report.checks.push('Persisted selection visibility/include-hidden preferences, explicit round controls and confirmed selected assignment with durable selected Undo');
  await control(session,`${panel} input[type=search]`,'Packaged worker target'); await apply(session);
  await session.wait(`document.querySelector('${panel} .applied-counts')?.textContent.includes('1 matching')`);
  assert.equal(await session.js(`document.querySelectorAll('${panel} .comment[data-view-role=match]').length`),1);
  await control(session,`${panel} input[type=search]`,'');
  await control(session,`${panel} select[name=discovery]`,'new'); await apply(session);
  assert.equal(await session.js(`document.querySelectorAll('${panel} .comment[data-view-role=match]').length`),1);
  await control(session,`${panel} select[name=discovery]`,'all');
  await control(session,`${panel} input[name=publication-from]`,'2026-01-01'); await apply(session);
  await control(session,`${panel} .discussion-sort select`,'newest');
  await session.wait(`document.querySelector('${panel} .discussion-ruler').dataset.newCount==='1'`);
  assert.equal(await session.js(`(()=>{const e=document.querySelector('${panel} .virtual-reader');return Number(e.dataset.rowCount)>200 && Number(e.dataset.mountedCount)<Number(e.dataset.rowCount)})()`),true);
  await session.js(`document.querySelector('${panel} .discussion-ruler').dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true}));document.querySelector('${panel} .discussion-ruler').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`);
  await session.js(`document.querySelector('${panel} .query-navigation button:nth-child(2)').click()`);
  await pause(600);
  assert.equal(await session.js(`!!document.querySelector('${panel} .comment[data-selected=true]')`),true,'Virtual navigation reveals selection');
  report.checks.push('Removed row gestures, explicit Ctrl+checkbox subtree, atomic rejection, durable Undo, restrictive ASAR worker, publication/discovery, sort, ruler and virtual reveal');
  await session.js("document.getElementById('settings-toggle').click()"); await pause(600);
  const peers=[], initialTargets=await(await fetch(`http://127.0.0.1:${session.port}/json/list`)).json();
  const nativePeers=initialTargets.filter(t=>t.type==='page'&&t.url.startsWith('file:')&&t.id!==session.targetId);
  assert.equal(nativePeers.length,2,'unmodified extracted EXE restores three independently seeded native windows');
  for(const target of nativePeers) {
    const peer=await attach(profile,performance.now(),'production-native-peer',target.id); peers.push(peer);
    for(const name of ['openLibrary','openSettings','openStoredItem']) {
      const state=await peer.invoke('bootstrap'); await peer.invoke(name,{expectedRevision:state.workspace.revision,...(name==='openStoredItem'?{itemId}:{})});
      if(name==='openSettings') await peer.wait("document.querySelectorAll('.helper-tool[aria-busy=false]').length===2");
    }
  }
  report.checks.push('Extracted EXE restores three independently seeded native windows; Library/Settings/discussion work in each; public New Window is tested separately by the production-entry M6 harness');
  // M8.2 toolbar menu reaches the same secured native creation/Close paths.
  async function applicationCommand(source, label) {
    await source.js('document.querySelector(".application-menu-trigger").click();void 0');
    await source.wait('!!document.querySelector("[role=menu]")');
    await source.js('Array.from(document.querySelectorAll("[role=menuitem]")).find(b=>b.querySelector("span")?.textContent===' + JSON.stringify(label) + ').click();void 0');
  }
  await applicationCommand(session, 'New Window');
  let extraTarget;
  for (let n = 0; n < 500; n++) {
    const targets = await (await fetch(`http://127.0.0.1:${session.port}/json/list`)).json();
    extraTarget = targets.find(t => t.type === 'page' && t.url.startsWith('file:') && !initialTargets.some(old => old.id === t.id));
    if (extraTarget) break; await pause(10);
  }
  assert.ok(extraTarget, 'toolbar New Window creates one native reader');
  const extra = await attach(profile, performance.now(), 'application-menu-peer', extraTarget.id);
  assert.deepEqual((await extra.invoke('bootstrap')).workspace.tabs, []);
  await applicationCommand(extra, 'Close Window'); extra.cdp.socket.close();
  for (let n = 0; n < 500 && tables(database).window_restore.length !== 3; n++) await pause(10);
  assert.equal(tables(database).window_restore.length, 3, 'toolbar Close restores the original intended set');
  report.checks.push('M8.2 extracted EXE toolbar New/Close routes authenticated lifecycle intents, creates an equal empty reader and removes only that peer from restoration');
  // Exercise the compiled M7 menu/chooser against the unmodified extracted EXE.
  // Renderer key/menu activation here is CDP automation; real native keyboard
  // input, provisional windows and crash injection are covered by test:m7.
  const movingView = viewId(await session.invoke('bootstrap'), itemId), destination = peers[0];
  async function packagedMove(source, target, id) {
    const targetState = await target.invoke('bootstrap'), targetTab = targetState.workspace.tabs[0];
    const targetWindowId = tables(database).tab_instances.find(t => t.id === targetTab.id).owner_window_id;
    const destinations = await source.js('window.reader.transfers.destinations()'); assert.equal(destinations.ok, true);
    const number = destinations.value.find(d => d.windowId === targetWindowId)?.number; assert.ok(number);
    await source.js('document.getElementById(' + JSON.stringify('tab-' + id) + ').dispatchEvent(new KeyboardEvent("keydown",{key:"F10",shiftKey:true,bubbles:true,cancelable:true}));void 0');
    await source.wait('!!document.querySelector("[role=menu]")');
    await source.js('Array.from(document.querySelectorAll("[role=menuitem]")).find(b=>b.textContent.startsWith("Move to Window")).click();void 0');
    const option = 'Array.from(document.querySelectorAll(".move-tab-option")).find(e=>e.querySelector("strong")?.textContent===' + JSON.stringify('Window ' + number) + ')?.querySelector("input")';
    await source.wait('!!(' + option + ')');
    const beforeSelection = (await source.invoke('bootstrap')).workspace;
    await source.js(option + '.click();void 0');
    assert.deepEqual((await source.invoke('bootstrap')).workspace, beforeSelection, 'destination selection leaves the source unchanged');
    await source.js('document.querySelector(".move-tab-footer button[type=submit]").click();void 0');
    await target.wait('document.getElementById(' + JSON.stringify('tab-' + id) + ')?.getAttribute("aria-selected")==="true"');
    await source.wait('!document.getElementById(' + JSON.stringify('tab-' + id) + ') && !document.querySelector(".app-shell").inert');
    await target.wait('!!document.getElementById(' + JSON.stringify('panel-' + id) + ')?.querySelector("form")');
  }
  await packagedMove(session, destination, movingView);
  const firstOwner = (await destination.invoke('bootstrap')).viewInstances[movingView];
  assert.equal((await destination.invoke('bootstrap')).workspace.tabs.filter(t => t.kind === 'discussion' && t.itemId === itemId).length, 2);
  await packagedMove(destination, session, movingView);
  const returned = await session.invoke('bootstrap'); assert.notEqual(returned.viewInstances[movingView].ownerGeneration, firstOwner.ownerGeneration);
  const stale = await session.js('window.reader.saveDiscussionView(' + JSON.stringify({ ...returned.discussionViews[movingView], viewId: movingView,
    expectedRevision: returned.viewInstances[movingView].intentRevision, ownerGeneration: firstOwner.ownerGeneration }) + ')');
  assert.equal(stale.ok, false); assert.equal(stale.error.code, 'FORBIDDEN');
  await session.js("document.getElementById('settings-toggle').click()");
  await session.wait("document.querySelectorAll('.helper-tool[aria-busy=false]').length===2");
  report.checks.push('Unmodified extracted EXE M7 menu/chooser transfers the same view out/back, retains independent same-item destination tabs and rejects stale owner authority before native backup/relaunch');
  const snapshot=path.join(root,'complete-backup.sqlite');
  await session.js("document.querySelector('.data-backups button').click()"); await native(session,'file',snapshot);
  await session.wait("document.querySelector('.data-backups > [role=status]')?.textContent.includes('complete-backup.sqlite')");
  const expected=tables(snapshot); assert.deepEqual(tables(database),expected);
  assert.equal(expected.window_restore.length,3);
  for(const peer of peers) await closePeer(peer);
  await close(session);
  session=await start(executable,environment,profile,'production-restart');
  boot=await session.invoke('bootstrap'); assert.equal(boot.preferences.translationTarget,'de');
  assert.equal(boot.preferences.selectionControls,'always'); assert.equal(boot.preferences.includeCollapsedInPrefix,false);
  for (const helper of report.helpers.filter(helper=>helper.path)) {
    const status=await session.invoke('getHelperStatus',{kind:helper.kind});
    assert.equal(status.path,helper.path); assert.equal(status.mode,'configured');
  }
  assert.ok(boot.seenUndo[itemId]); assert.equal(boot.discussionViews[viewId(boot,itemId)].sort,'newest');
  assert.equal(boot.discussionViews[viewId(boot,itemId)].applied.publication.from,'2026-01-01');
  const beforeReconstruction=boot.comments[itemId];
  await session.js(`${tabElement(itemId)}.click()`);
  await session.wait(`document.querySelector('${panel} .discussion-sort select')?.value==='newest' && document.querySelector('${panel} input[name=publication-from]')?.value==='2026-01-01' && document.querySelector('${panel} .discussion-ruler')?.dataset.newCount==='1'`);
  await session.wait(`Array.from(document.querySelectorAll('[role=tabpanel]:not([hidden]) article.comment')).find(row=>row.dataset.domainCommentId===${JSON.stringify(boot.discussionViews[viewId(boot,itemId)].selected)})?.dataset.selected==='true'`);
  assert.deepEqual((await session.invoke('bootstrap')).comments[itemId],beforeReconstruction,'Restart reconstruction never writes seen');
  await session.invoke('undoSeen',{itemId});
  assert.equal((await session.invoke('bootstrap')).seenUndo[itemId],null);
  report.checks.push('Restart preserves source history/NEW, view intent and durable Undo; Undo remains usable');
  await session.js("document.getElementById('settings-toggle').click()"); await pause(250);
  const beforeRestore=tables(database);
  await session.js("document.querySelector('.data-backups button:last-child').click()");
  await native(session,'file',snapshot); await native(session,'confirm');
  const oldPid=session.pid, started=performance.now();
  await new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(new Error('Restore did not quit')),30000);
    if(session.child.exitCode!==null) {clearTimeout(timeout);resolve();} else session.child.once('exit',code=>{clearTimeout(timeout);code===0?resolve():reject(new Error(`Restore exit ${code}`));});
  });
  session.cdp.socket.close();
  // The startup acknowledgement can appear before Chromium publishes CDP. Find
  // the new owned browser PID through Windows, dismiss it, then attach normally.
  let relaunchedPid;
  for (let i=0;i<80;i++) {
    const value=await command('powershell.exe',['-NoProfile','-Command',`Get-CimInstance Win32_Process -Filter "Name = 'youtube-comments.exe'" | Where-Object { $_.ExecutablePath -eq $env:PACKAGED_EXPECTED_EXE -and $_.ProcessId -ne ${oldPid} -and $_.CommandLine -notmatch '--type=' } | Select-Object -First 1 -ExpandProperty ProcessId`],{env:{...process.env,PACKAGED_EXPECTED_EXE:executable}});
    if (value.trim()) { relaunchedPid=Number(value.trim()); break; }
    await pause(100);
  }
  assert.ok(relaunchedPid,'Actual packaged relaunch process');
  current={pid:relaunchedPid,js:async()=>undefined,cdp:{socket:{close(){}}}};
  await native({pid:relaunchedPid},'acknowledge');
  session=await attach(profile,started,'production-real-relaunch',undefined,primaryViewId); assert.notEqual(session.pid,oldPid);
  await session.wait("!document.querySelector('#panel-settings:not([hidden])') || document.querySelectorAll('.helper-tool[aria-busy=false]').length===2");
  console.log(await command('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'packaged-native-dialog.ps1'),'-ApplicationPid',String(session.pid),'-Action','readers-ready','-ExpectedReaders','3']));
  assert.deepEqual(tables(database),expected); assert.equal((await session.invoke('bootstrap')).preferences.translationTarget,'de');
  const recovery=path.join(profile,'recovery');
  const transactions=fs.readdirSync(recovery).filter(name=>name.startsWith('restore-'));
  assert.equal(transactions.length,1);
  assert.deepEqual(tables(path.join(recovery,transactions[0],'safety.sqlite')),beforeRestore);
  assert.ok(fs.existsSync(path.join(recovery,transactions[0],'complete')));
  report.checks.push('Native Settings backup, confirmed restore, actual app.relaunch into extracted EXE, exact all-table restoration and independent safety');
  const restoredTargets=await(await fetch(`http://127.0.0.1:${session.port}/json/list`)).json();
  const restoredPeers=restoredTargets.filter(t=>t.type==='page'&&t.url.startsWith('file:')&&t.id!==session.targetId);
  assert.equal(restoredPeers.length,2,'real extracted-EXE relaunch restores all three intended windows');
  for(const target of restoredPeers) {
    const peer=await attach(profile,performance.now(),'production-restored-peer',target.id);
    assert.ok((await peer.invoke('bootstrap')).workspace.tabs.some(t=>t.kind==='discussion')); await closePeer(peer);
  }
  current=session;
  report.checks.push('Real extracted-EXE relaunch restores exactly three windows and original owned view identities; peer Close leaves the retained window usable');
  // Process identity is observed externally without enabling Node inspection.
  const processInfo=await command('powershell.exe',['-NoProfile','-Command',`Get-CimInstance Win32_Process -Filter 'ProcessId = ${session.pid}' | Select-Object ExecutablePath,CommandLine | ConvertTo-Json -Compress`]);
  assert.ok(processInfo.includes('extracted application')); report.relaunch=JSON.parse(processInfo);
  if (process.argv.includes('--live')) {
    // Separate, explicitly requested network checks. Log counts, never content.
    for (const helper of report.helpers.filter(helper=>helper.path)) {
      const url=helper.kind==='yt-dlp'?'https://www.youtube.com/watch?v=IFPKfypw2CQ':'https://www.youtube.com/post/UgkxLEL8EllifRA8ZLoEkkTXSJaa0s_cWf6n';
      const begin=performance.now(), acquired=await session.invoke('acquire',{url});
      const id=acquired.summary.itemId, first=acquired.state.comments[id][0];
      assert.ok(first); await session.invoke('toggleSeen',{itemId:id,commentId:first.id,subtree:false});
      const refreshed=await session.invoke('refresh',{itemId:id});
      assert.equal(refreshed.summary.itemId,id); assert.equal(refreshed.state.comments[id].find(c=>c.id===first.id).seen,true);
      helper.live={comments:refreshed.state.comments[id].length,acquireCoverage:acquired.summary.coverage,refreshCoverage:refreshed.summary.coverage,insertedOnRefresh:refreshed.summary.inserted,milliseconds:Math.round(performance.now()-begin)};
      console.log(JSON.stringify({kind:helper.kind,...helper.live}));
    }
  }
  await close(session);
  // The original packaged folder is an independent copy of the extracted app.
  // Both must find the same explicit test account/profile, with no EXE-local data.
  session=await start(path.join(packageDirectory,'youtube-comments.exe'),environment,profile,'production-copied-application');
  const copied=await session.invoke('bootstrap');
  assert.ok(copied.items.some(item=>item.id===itemId));
  assert.equal(copied.discussionViews[viewId(copied,itemId)].sort,'newest'); assert.equal(copied.preferences.translationTarget,'de');
  assert.deepEqual(tables(database).helper_settings,expected.helper_settings);
  await close(session);
  report.checks.push('Original out/ EXE also launches from a temporary working directory and shares the copied folder production profile');
  if (process.argv.includes('--compare-startup')) {
    // Compare the same closed data and external ready-point instrumentation.
    const developmentProfile=path.join(roaming,'youtube-comments-development');
    fs.mkdirSync(developmentProfile);
    for (const suffix of ['-wal','-shm','-journal']) assert.equal(fs.existsSync(database+suffix),false,'Copy only closed/checkpointed data');
    fs.copyFileSync(database,path.join(developmentProfile,'reader.sqlite'));
    session=await start(require('electron'),environment,developmentProfile,'development-built-entry-comparison',path.resolve(__dirname,'../.vite/build/main.js'));
    assert.equal((await session.invoke('bootstrap')).items.length,copied.items.length);
    await close(session);
    report.checks.push('Same-data built-entry development startup compared at the same external rendered-shell ready point');
  }
  report.checks.push('Controlled clean shutdown; package needs no Vite server, checkout working directory or development command');
  fs.writeFileSync(path.join(logDirectory,'packaged-smoke.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
}
run().catch(async error=>{
  console.error(error);
  if(current) {
    void current.js('window.close()').catch(()=>undefined); current.cdp.socket.close();
    // Failed tests may leave a native modal open. Reap only this owned test PID
    // and its descendants; success always uses the verified normal quit path.
    await command(path.join(process.env.SystemRoot || 'C:\\Windows','System32','taskkill.exe'),['/PID',String(current.pid),'/T','/F']).catch(()=>undefined);
  }
  fs.writeFileSync(path.join(logDirectory,'packaged-smoke-failed.json'),JSON.stringify({...report,error:String(error)},null,2));
  process.exitCode=1;
});
