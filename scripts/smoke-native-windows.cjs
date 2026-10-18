// M6: actual production main entry, equal native windows and real process starts.
// Dialog answers/helper bytes are main-only fixtures; no shipped test capability.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const database = root => path.join(root, 'youtube-comments-development', 'reader.sqlite');
function inspect(root, action) { const db = new DatabaseSync(database(root), { readOnly: true }); try { return JSON.parse(JSON.stringify(action(db))); } finally { db.close(); } }
const session = root => inspect(root, db => ({ ids: db.prepare('SELECT window_id FROM window_restore ORDER BY position').all().map(r => r.window_id), focus: db.prepare('SELECT last_focused_id FROM window_session').get().last_focused_id }));
if (process.versions.electron) {
  require('./thumbnail-fixture-network.cjs').installThumbnailNetwork();
  const { app, BrowserWindow, Menu, dialog, ipcMain, screen } = require('electron');
  const root = process.env.YOUTUBE_COMMENTS_DEMO_ROOT, phase = process.env.M6_PHASE;
  assert.ok(root && path.dirname(root) === os.tmpdir() && path.basename(root).startsWith('reader-m6-electron-'));
  for (const name of ['appData','userData','sessionData','logs','crashDumps']) { const folder = path.join(root,name); fs.mkdirSync(folder,{recursive:true}); app.setPath(name,folder); }
  const fail = error => { console.error('M6', phase, error); app.exit(1); };
  process.on('uncaughtException',fail); process.on('unhandledRejection',fail);
  const watchdog = setTimeout(() => fail(new Error('watchdog')),120000);
  let verified = false, restarted = false, holdDrain = false, releaseDrain, terminalHold = false;
  const quit = app.quit.bind(app); app.quit = () => { if (!terminalHold) quit(); };
  const created = [], events = new Map(), handle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (channel, handler) => handle(channel, async (event, ...args) => {
    events.set(event.sender, event);
    const result = await handler(event, ...args);
    if (channel === 'reader:profile-drain' && holdDrain) { holdDrain = false; await new Promise(resolve => { releaseDrain = resolve; }); }
    return result;
  });
  dialog.showSaveDialog = async () => ({ canceled: false, filePath: path.join(root,'snapshot.sqlite') });
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path.join(root,'snapshot.sqlite')] });
  dialog.showMessageBox = async () => ({ response: 1 });
  app.relaunch = () => { restarted = true; terminalHold = true; };
  // Exercise production resolver/probe/extraction/progress/merge without network.
  const helper = path.join(root,'fixture-helper.exe'); fs.writeFileSync(helper,'test fixture, never executed');
  process.env.YOUTUBE_COMMENTS_YTDLP_EXE = helper;
  process.env.YOUTUBE_COMMENTS_POST_ARCHIVER_EXE = path.join(root,'missing.exe');
  const childProcess = require('node:child_process'), launch = childProcess.spawn;
  const fixture = JSON.parse(fs.readFileSync(path.resolve(__dirname,'../src/main/extractors/__fixtures__/yt-nested-a.json')));
  let fetches = 0, releaseFetch;
  childProcess.spawn = (file,args,...rest) => {
    if (file !== helper) return launch(file,args,...rest);
    const child = new (require('node:events').EventEmitter)();
    child.stdout = new (require('node:stream').PassThrough)(); child.stderr = new (require('node:stream').PassThrough)();
    child.kill = () => { child.emit('close',1); return true; };
    if (args.includes('--version')) setImmediate(() => { child.stdout.write('2026.08.19\n'); child.emit('close',0); });
    else { fetches++; releaseFetch = () => { child.stdout.write(JSON.stringify(fixture.raw)); child.emit('close',0); }; }
    return child;
  };
  app.on('browser-window-created',(_event,window) => {
    assert.equal(window.getParentWindow(),null,'every reader has no parent'); created.push(window); window.webContents.setBackgroundThrottling(false);
    window.webContents.once('preload-error',(_event,_file,error)=>fail(error));
  });
  const js = (w,code) => w.webContents.executeJavaScript(code);
  async function wait(check,label) { for (let n=0;n<1500;n++) { if (await check()) return; await pause(10); } throw Error('Timeout: '+label); }
  const ready = w => wait(() => js(w,"!!document.querySelector('.app-shell')"),'own bootstrap');
  const boot = async w => { const r = await js(w,'window.reader.bootstrap()'); assert.equal(r.ok,true,JSON.stringify(r)); return r.value; };
  const topology = ['openLibrary','openSettings','openStoredItem','activateTab','closeTab','moveTab'];
  async function invoke(w,name,payload) {
    if (topology.includes(name)) payload = { ...payload, expectedRevision: (await boot(w)).workspace.revision };
    const r = await js(w,'window.reader.'+name+'('+(payload===undefined?'':JSON.stringify(payload))+')');
    assert.equal(r.ok,true,name+': '+JSON.stringify(r)); return r.value;
  }
  async function draft(w,text) {
    await wait(() => js(w,"!!document.querySelector('.reader-panel:not([hidden]) input[type=search]')"),'active reader');
    await js(w,'(()=>{const e=document.querySelector(".reader-panel:not([hidden]) input[type=search]");Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(e,'+JSON.stringify(text)+');e.dispatchEvent(new Event("input",{bubbles:true}));})()');
  }
  const liveWindows = () => BrowserWindow.getAllWindows().filter(w => !w.isDestroyed());
  async function newWindow(keyboardOrigin) {
    const before = created.length, command = Menu.getApplicationMenu().getMenuItemById('new-reader-window');
    assert.equal(command.accelerator,'CmdOrCtrl+N');
    if (keyboardOrigin) {
      keyboardOrigin.focus(); keyboardOrigin.webContents.sendInputEvent({type:'keyDown',keyCode:'N',modifiers:['control']});
      keyboardOrigin.webContents.sendInputEvent({type:'keyUp',keyCode:'N',modifiers:['control']});
    } else command.click();
    await wait(() => created.length===before+1,'native New Window command');
    const w=created.at(-1); await ready(w); assert.deepEqual((await boot(w)).workspace,{tabs:[],activeTabId:null,revision:0}); return w;
  }
  async function capture(name) {
    const rows = inspect(root, db => Object.fromEntries(['window_geometry','app_windows','tab_instances','window_tabs','discussion_views','discussion_view_intent','view_collapse','view_collapse_overrides','item_resume_view'].map(t => [t,db.prepare('SELECT * FROM '+t+' ORDER BY rowid').all()])));
    fs.writeFileSync(path.join(root,name+'.json'),JSON.stringify({ session:session(root), rows }));
  }
  app.whenReady().then(async () => {
    await wait(() => created.length>0,'production window'); await ready(created[0]);
    console.log('M6 phase',phase,'displays',JSON.stringify(screen.getAllDisplays().map(d=>({id:d.id,label:d.label,bounds:d.bounds,workArea:d.workArea,scaleFactor:d.scaleFactor,internal:d.internal}))));
    if (phase==='write') {
      const a=created[0], b=await newWindow(), c=await newWindow(b);
      const second=spawn(process.execPath,[path.resolve(__dirname,'../.vite/build/main.js')],{env:process.env,stdio:'ignore',windowsHide:true});
      await new Promise((resolve,reject)=>{second.once('error',reject);second.once('exit',code=>code===0?resolve():reject(Error('second instance '+code)));});
      assert.equal(liveWindows().length,3,'second instance cannot create another SQLite owner/window');
      for (const w of [a,b,c]) {
        await invoke(w,'openLibrary'); await invoke(w,'openSettings');
        await wait(() => js(w,"document.querySelectorAll('.helper-tool[aria-busy=false]').length===2"),'helper acknowledgments');
        await invoke(w,'openStoredItem',{itemId:'video-demo'});
      }
      assert.equal(new Set((await Promise.all([a,b,c].map(boot))).map(s=>s.workspace.activeTabId)).size,3);
      const source=(await boot(b)).workspace.activeTabId;
      await js(b,'document.getElementById('+JSON.stringify('tab-'+source)+').dispatchEvent(new KeyboardEvent("keydown",{key:"F10",shiftKey:true,bubbles:true,cancelable:true}));void 0');
      await wait(() => js(b,'!!document.querySelector("[role=menuitem]")'),'Duplicate menu');
      await js(b,'document.querySelector("[role=menuitem]").click();void 0');
      await wait(async () => (await boot(b)).workspace.activeTabId!==source,'duplicate independent instance');
      const foreign=(await boot(c)).workspace.activeTabId;
      assert.equal((await js(b,'window.reader.getDiscussionView({viewId:'+JSON.stringify(foreign)+'})')).error.code,'FORBIDDEN');
      const assignments=await Promise.all([b,c].map(w=>invoke(w,'toggleSeen',{itemId:'video-demo',commentId:'v3',subtree:false,seen:true})));
      assert.ok(assignments.every(v=>v.changedCount<=1));
      const bulk=await invoke(a,'bulkSeen',{itemId:'video-demo',seen:true,target:{kind:'all'}});
      await invoke(c,'undoSeen',{itemId:'video-demo',expectedOperationId:bulk.undo.id});
      await invoke(b,'updatePreferences',{appearance:'dark'});
      for (const w of [a,c]) await wait(() => js(w,"document.documentElement.dataset.appearance==='dark'"),'shared preferences');
      for (const w of [a,b,c]) await js(w,'window.m6Progress=[];window.reader.onAcquisitionProgress(e=>window.m6Progress.push(e));void 0');
      const acquisition=invoke(b,'acquire',{url:'https://www.youtube.com/watch?v='+fixture.raw.id});
      await wait(() => !!releaseFetch,'helper fetch');
      for (const w of [a,b,c]) await wait(() => js(w,'window.m6Progress.some(e=>e.stage==="fetching")'),'progress fanout');
      // First-created window closes DURING shared acquisition, peers retain it.
      a.close(); await wait(() => a.isDestroyed(),'first-created close'); assert.equal(liveWindows().length,2);
      releaseFetch(); releaseFetch=undefined; const acquired=await acquisition;
      assert.equal(fetches,1); await invoke(c,'openStoredItem',{itemId:acquired.summary.itemId});
      const refreshed=invoke(c,'refresh',{itemId:acquired.summary.itemId}); await wait(()=>!!releaseFetch,'Refresh helper'); releaseFetch(); releaseFetch=undefined; await refreshed;
      // Real controlled reload and renderer crash preserve healthy peer identity.
      const bTabs=(await boot(b)).workspace; b.focus(); Menu.getApplicationMenu().items.find(i=>i.label==='View').submenu.items.find(i=>i.label==='Reload').click();
      await wait(()=>js(b,"!!document.querySelector('.app-shell')"),'controlled reload');
      await wait(async()=>JSON.stringify((await boot(b)).workspace)===JSON.stringify(bTabs),'reload topology');
      c.webContents.forcefullyCrashRenderer(); await pause(150); b.focus();
      await invoke(b,'toggleSeen',{itemId:'video-demo',commentId:'v1',subtree:false,seen:false});
      c.focus(); Menu.getApplicationMenu().items.find(i=>i.label==='View').submenu.items.find(i=>i.label==='Reload').click(); await ready(c);
      await invoke(b,'openStoredItem',{itemId:'video-demo'}); await invoke(c,'openStoredItem',{itemId:'video-demo'});
      const displays=screen.getAllDisplays(), area=(displays[1]??displays[0]).workArea, other=(displays[2]??displays[0]).workArea;
      b.setBounds({x:area.x+20,y:area.y+20,width:Math.min(1000,area.width),height:Math.min(760,area.height)});
      c.setBounds({x:other.x+10,y:other.y+10,width:Math.min(1100,other.width-20),height:Math.min(800,other.height-20)}); c.maximize();
      await draft(b,'M6 pending B'); await draft(c,'M6 pending C');
      await invoke(b,'createBackup');
      assert.equal(session(root).ids.length,2); await capture('restart');
      // A third equal EMPTY window must remain empty after restart.
      const d=await newWindow(); b.minimize(); c.minimize(); d.focus(); await pause(300);
      holdDrain=true; await draft(b,'M6 quit B'); await draft(c,'M6 quit C');
      verified=true; app.quit(); app.quit();
      await wait(()=>!!releaseDrain,'pending Quit checkpoint'); assert.equal(liveWindows().length,3);
      assert.equal(session(root).ids.length,3); releaseDrain();
    } else {
      const expected=JSON.parse(fs.readFileSync(path.join(root,'after-'+({restart:'write',crash:'restart',restore:'crash',last:'restore',final:'last'}[phase])+'.json')));
      await wait(()=>created.length===expected.session.ids.length,'complete intended restore set');
      await Promise.all(created.map(ready)); await wait(()=>created.every(w=>w.isVisible()),'visible reachable windows');
      assert.ok(created.every(w=>!w.isMinimized()),'minimized never forces hidden restart');
      assert.deepEqual(session(root).ids,expected.session.ids);
      const actual=inspect(root,db=>db.prepare('SELECT * FROM window_tabs ORDER BY rowid').all()); assert.deepEqual(actual,expected.rows.window_tabs);
      assert.deepEqual(inspect(root,db=>db.prepare('SELECT * FROM app_windows ORDER BY rowid').all()),expected.rows.app_windows,'exact active tabs and topology revisions restore per window');
      assert.ok(inspect(root,db=>db.prepare('SELECT count(*) AS n FROM app_windows').get().n)>created.length,'dormant historical windows never open');
      if (phase==='restart') {
        assert.equal(created.length,3); const states=await Promise.all(created.map(boot));
        assert.ok(states.some(s=>s.workspace.tabs.length===0),'empty restored workspace');
        assert.ok(states.some(s=>Object.values(s.discussionViews).some(v=>v.draft.text==='M6 quit B')));
        assert.ok(states.some(s=>Object.values(s.discussionViews).some(v=>v.draft.text==='M6 quit C')));
        const max=inspect(root,db=>db.prepare("SELECT window_id FROM window_geometry WHERE json_extract(geometry_json,'$.maximized')=1").get());
        assert.ok(max); assert.equal(created[session(root).ids.indexOf(max.window_id)].isMaximized(),true);
        const geometries=expected.rows.window_geometry;
        for(let i=0;i<created.length;i++) {
          const id=session(root).ids[i], saved=JSON.parse(geometries.find(g=>g.window_id===id).geometry_json);
          const actual=created[i].getNormalBounds();
          // Windows can enlarge normal bounds while moving between 100%/150%.
          // Restart must match the CURRENT-area clamp, not an oversized raw rect.
          const area=screen.getAllDisplays().find(d=>String(d.id)===saved.display.id).workArea;
          const width=Math.min(area.width,Math.max(Math.min(720,area.width),saved.normal.width));
          const height=Math.min(area.height,Math.max(Math.min(520,area.height),saved.normal.height));
          const safe={x:Math.max(area.x,Math.min(saved.normal.x,area.x+area.width-width)),y:Math.max(area.y,Math.min(saved.normal.y,area.y+area.height-height)),width,height};
          for(const key of ['x','y','width','height']) assert.ok(Math.abs(actual[key]-safe[key])<=1,'restored safe normal DIP '+key+': '+JSON.stringify({id,saved:saved.normal,safe,actual,maximized:created[i].isMaximized()}));
          assert.equal(String(screen.getDisplayMatching(actual).id),saved.display.id,'actual connected display placement');
        }
        // Abrupt process termination skips Quit and retains acknowledged membership.
        await capture('after-restart'); verified=true; app.exit(0); return;
      } else if (phase==='crash') {
        assert.equal(created.length,3);
        const b=created[0]; await invoke(b,'restoreBackup');
        await wait(()=>restarted,'offline restore relaunch requested');
        const before=inspect(root,db=>db.prepare('SELECT * FROM window_geometry ORDER BY rowid').all());
        for(const w of created) {
          w.setBounds({x:80,y:80,width:1000,height:700});
          const result=await js(w,'window.reader.updatePreferences({appearance:"light"})');
          assert.equal(result.error.code,'DATA_BUSY','old windows remain fenced offline');
        }
        await pause(350);
        assert.deepEqual(inspect(root,db=>db.prepare('SELECT * FROM window_geometry ORDER BY rowid').all()),before,'late native events cannot write replacement geometry');
        verified=true; terminalHold=false; quit();
        return;
      } else if (phase==='restore') {
        // Restored snapshot had B/C, before the third empty window was created.
        assert.equal(created.length,2); await js(created[1],'window.close()'); await wait(()=>created[1].isDestroyed(),'reverse authenticated page/native close order');
        assert.equal(session(root).ids.length,1,'native Close removes only its restore member');
        await invoke(created[0],'openLibrary'); created[0].close(); verified=true;
      } else if (phase==='last') {
        assert.equal(created.length,1); assert.equal((await boot(created[0])).workspace.tabs.some(t=>t.kind==='library'),true);
        verified=true; created[0].close();
      } else { assert.equal(created.length,1); verified=true; created[0].close(); }
    }
  }).catch(fail);
  app.on('will-quit',()=>{ assert.equal(verified,true); clearTimeout(watchdog); console.log('M6 PASS',phase); });
  require(path.resolve(__dirname,'../.vite/build/main.js'));
} else {
  (async()=>{
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'reader-m6-electron-'));
    try {
      for (const phase of ['write','restart','crash','restore','last','final']) {
        // Restore phase expects the snapshot's complete topology, not the live set
        // saved after the preceding abrupt-exit/restore initiator process.
        if(phase==='restore') {
          const db=new DatabaseSync(path.join(root,'snapshot.sqlite'),{readOnly:true});
          try { fs.writeFileSync(path.join(root,'after-crash.json'),JSON.stringify({session:{ids:db.prepare('SELECT window_id FROM window_restore ORDER BY position').all().map(r=>r.window_id)},rows:{window_tabs:db.prepare('SELECT * FROM window_tabs ORDER BY rowid').all(),app_windows:db.prepare('SELECT * FROM app_windows ORDER BY rowid').all()}})); } finally { db.close(); }
        }
        const env={...process.env,YOUTUBE_COMMENTS_DEMO_ROOT:root,M6_PHASE:phase}; delete env.ELECTRON_RUN_AS_NODE;
        const child=spawn(require('electron'),[__filename],{env,stdio:'inherit',windowsHide:true});
        await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error('M6 '+phase+' exited '+code)));});
        const rows=inspect(root,db=>Object.fromEntries(['window_geometry','app_windows','tab_instances','window_tabs','discussion_views','discussion_view_intent','view_collapse','view_collapse_overrides','item_resume_view'].map(t=>[t,db.prepare('SELECT * FROM '+t+' ORDER BY rowid').all()])));
        fs.writeFileSync(path.join(root,'after-'+phase+'.json'),JSON.stringify({session:session(root),rows}));
      }
      console.log('M6 production-entry all phases PASS',root);
    } finally { assert.ok(path.dirname(root)===os.tmpdir()&&path.basename(root).startsWith('reader-m6-electron-')); fs.rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:100}); }
  })().catch(error=>{console.error(error);process.exitCode=1;});
}
