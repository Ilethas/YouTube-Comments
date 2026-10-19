// M5: actual built React/worker/preload/IPC, authenticated test windows and
// process restarts. All data and Electron account directories are disposable.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const checkpoint = state => ({workspace:state.workspace,views:state.discussionViews,collapse:state.discussionCollapse,instances:state.viewInstances,comments:state.comments,undo:state.seenUndo});
const page = path.resolve(__dirname, '../.vite/renderer/main_window/index.html');
const preload = path.resolve(__dirname, '../.vite/build/preload.js');
if (process.versions.electron) {
  const { app } = require('electron');
  const root = process.env.M5_ROOT, phase = process.env.M5_PHASE;
  assert.ok(root && path.dirname(root) === os.tmpdir() && path.basename(root).startsWith('reader-m5-electron-'));
  for (const name of ['appData', 'userData', 'sessionData', 'logs', 'crashDumps']) { const folder=path.join(root,name); fs.mkdirSync(folder,{recursive:true}); app.setPath(name,folder); }
  const tools = require(path.join(root,'tools.cjs'));
  const { ReaderRepository, ReaderService, WindowCoordinator, registerReaderIpc, normalizeYtDlp } = tools;
  const watchdog=setTimeout(()=>{console.error('M5 timeout',phase);app.exit(1);},90000);
  const fail=error=>{console.error(error);app.exit(1);}; process.on('uncaughtException',fail);
  app.on('browser-window-created',(_e,w)=>{w.hide();w.webContents.setBackgroundThrottling(false);});
  app.whenReady().then(async()=>{
    const file=path.join(root,'profile','reader.sqlite'), backup=path.join(root,'snapshot.sqlite');
    const repo=ReaderRepository.open(file), identities=JSON.parse(fs.readFileSync(path.join(root,'ids.json')));
    const windows=new WindowCoordinator(pathToFileURL(page).href,preload);
    const fixture=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../src/main/extractors/__fixtures__/yt-nested-a.json')));
    const service=new ReaderService(()=>repo,['en'],console.error,async()=>{
      fixture.raw.comments.push({id:'m5-new-root',parent:'root',text:'M5 new evidence',timestamp:1790856000});
      return {extraction:normalizeYtDlp(JSON.stringify(fixture.raw),fixture.context)};
    },{},undefined,value=>windows.sendAcquisitionProgress(value),{databasePath:file,dialogs:{save:async()=>backup,select:async()=>backup,confirm:async()=>true},restart:()=>{console.log('M5 restored offline; orchestrator starts new process');app.exit(0);}});
    const lifecycle=registerReaderIpc(service,windows);
    const a=windows.createReaderWindow();
    const js=(w,code)=>w.webContents.executeJavaScript(code);
    async function wait(check,label){for(let n=0;n<1000;n++){if(await check())return;await pause(10);}throw Error('M5 '+label);}
    const boot=async w=>{const r=await js(w,'window.reader.bootstrap()');assert.equal(r.ok,true);return JSON.parse(JSON.stringify(r.value));};
    async function invoke(w,name,payload){if(['openStoredItem','activateTab','closeTab','moveTab','openLibrary','openSettings'].includes(name))payload={...payload,expectedRevision:(await boot(w)).workspace.revision};const r=await js(w,'window.reader.'+name+'('+ (payload?JSON.stringify(payload):'')+')');assert.equal(r.ok,true,name+': '+JSON.stringify(r));return r.value;}
    const panel=id=>'document.getElementById('+JSON.stringify('panel-'+id)+')';
    const ready=w=>wait(()=>js(w,"!!document.querySelector('.app-shell')"),'reader ready'); await ready(a);
    // M6's secured factory starts hidden. This custom M5 harness owns its show
    // policy; establish a real focused native document for tab-focus assertions.
    a.show(); a.focus();
    // Diagnose a possible aggregate-only focus failure without changing readiness
    // conditions or the production focus implementation. No waits are added.
    await js(a, `window.__m5Focus=[];(()=>{const original=HTMLElement.prototype.focus;HTMLElement.prototype.focus=function(...args){if(window.__m5Focus.length<100)window.__m5Focus.push({id:this.id,disabled:!!this.disabled,inert:!!this.closest('[inert]'),at:performance.now()});return original.apply(this,args);};})()`);
    async function active(id){await invoke(a,'activateTab',{tabId:id});await wait(()=>js(a,panel(id)+"?.hidden===false && !!"+panel(id)+".querySelector('form')"),'active view hydrated');}
    const input=async(id,text)=>js(a,'(()=>{const e='+panel(id)+'.querySelector("input[type=search]");Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(e,'+JSON.stringify(text)+');e.dispatchEvent(new Event("input",{bubbles:true}));})()');
    async function choose(id,selector,value){await js(a,'(()=>{const e='+panel(id)+'.querySelector('+JSON.stringify(selector)+');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,"value").set.call(e,'+JSON.stringify(value)+');e.dispatchEvent(new Event("change",{bubbles:true}));})()');}
    async function apply(id){await js(a,panel(id)+'.querySelector("form").requestSubmit();void 0');await wait(()=>js(a,'!'+panel(id)+'.querySelector(".query-status").textContent.includes("Evaluating")'),'worker settled');}
    async function duplicate(id){
      const before=await boot(a);
      await js(a,'document.getElementById('+JSON.stringify('tab-'+id)+').dispatchEvent(new KeyboardEvent("keydown",{key:"F10",shiftKey:true,bubbles:true,cancelable:true}));void 0');
      await wait(()=>js(a,'!!document.querySelector("[role=menuitem]")'),'tab menu');
      await js(a,'document.querySelector("[role=menuitem]").click();void 0');
      await wait(async()=> (await boot(a)).workspace.tabs.length===before.workspace.tabs.length+1,'clone committed');
      const state=await boot(a), next=state.workspace.activeTabId;
      assert.notEqual(next,id); assert.equal(state.viewInstances[next].itemId,state.viewInstances[id].itemId);
      assert.equal(state.workspace.tabs.findIndex(t=>t.id===next),before.workspace.tabs.findIndex(t=>t.id===id)+1);
      await wait(()=>js(a,'!!'+panel(next)+'?.querySelector("form")'),'dynamic hydration');
      try { await wait(()=>js(a,'document.activeElement?.id==='+JSON.stringify('tab-'+next)),'focus new tab'); }
      catch (error) { throw Error(String(error) + ': ' + await js(a, 'JSON.stringify({focused:document.hasFocus(),active:document.activeElement?.id,calls:window.__m5Focus})')); }
      return next;
    }
    if(phase==='write'){
      await active(identities.videoView);
      await input(identities.videoView,'root'); await apply(identities.videoView);
      await js(a,panel(identities.videoView)+'.scrollTop=5000;'+panel(identities.videoView)+'.dispatchEvent(new Event("scroll"));void 0');
      await wait(async()=>!!(await boot(a)).discussionViews[identities.videoView]?.anchor.commentId,'source logical anchor persisted');
      await input(identities.videoView,'video source draft');
      const videoClone=await duplicate(identities.videoView);
      assert.equal(await js(a,panel(videoClone)+'.querySelector("input[type=search]").value'),'video source draft');
      await input(videoClone,'');await choose(videoClone,'select[name=seen]','unseen');await apply(videoClone);await input(videoClone,'video clone draft');
      await choose(videoClone,'.discussion-sort select','newest');
      await js(a,panel(videoClone)+'.querySelector(".expansion-controls button:last-child").click();void 0');
      await active(identities.postView);await input(identities.postView,'thread');await apply(identities.postView);await input(identities.postView,'post source draft');
      const postClone=await duplicate(identities.postView);await input(postClone,'reply');await apply(postClone);await input(postClone,'post clone draft');
      await choose(postClone,'.discussion-sort select','oldest');
      const ids=await js(a,'Array.from(document.querySelectorAll("[id]")).map(e=>e.id)');assert.equal(new Set(ids).size,ids.length,'unique IDs with same-item panels mounted');
      await active(videoClone);
      await js(a,'document.body.dispatchEvent(new KeyboardEvent("keydown",{key:"F3",bubbles:true,cancelable:true}));void 0');
      await wait(()=>js(a,'document.activeElement?.closest(".reader-panel")?.dataset.viewId==='+JSON.stringify(videoClone)),'F3 owned focus');
      const b=windows.createReaderWindow();await ready(b);await invoke(b,'openStoredItem',{itemId:identities.video});
      const foreign=await js(b,'window.reader.getDiscussionView({viewId:'+JSON.stringify(videoClone)+'})');assert.equal(foreign.error.code,'FORBIDDEN');
      const invalid=await js(b,'window.reader.duplicateTab('+JSON.stringify({sourceViewId:videoClone,expectedRevision:(await boot(b)).workspace.revision,intentRevision:0,collapseRevision:0})+')');assert.equal(invalid.error.code,'FORBIDDEN');
      const marked=await invoke(a,'bulkSeen',{itemId:identities.video,seen:true,target:{kind:'all'}});
      await wait(()=>js(a,'Array.from(document.querySelectorAll(".seen-control input")).filter(e=>e.closest(".reader-panel").dataset.itemId==='+JSON.stringify(identities.video)+').every(e=>e.checked)'),'shared seen duplicate');
      assert.equal((await boot(b)).seenUndo[identities.video].id,marked.undo.id);
      const newer=await invoke(b,'bulkSeen',{itemId:identities.video,seen:false,target:{kind:'all'}});
      const stale=await js(a,'window.reader.undoSeen('+JSON.stringify({itemId:identities.video,expectedOperationId:marked.undo.id})+')');assert.equal(stale.error.code,'UNDO_CONFLICT');
      await invoke(a,'undoSeen',{itemId:identities.video,expectedOperationId:newer.undo.id});
      // Refresh each instantiated view with its own applied query, preserving its draft.
      await active(videoClone);await invoke(a,'refresh',{itemId:identities.video});
      await wait(()=>js(a,'!'+panel(videoClone)+'.querySelector(".query-status").textContent.includes("Evaluating")'),'all Refresh workers');
      assert.equal(await js(a,panel(identities.videoView)+'.querySelector("input[type=search]").value'),'video source draft');
      assert.equal(await js(a,panel(videoClone)+'.querySelector("input[type=search]").value'),'video clone draft');
      await wait(()=>js(a,panel(videoClone)+'.textContent.includes("M5 new evidence")'),'clone Refresh uses unseen criteria');
      assert.equal(await js(a,panel(identities.videoView)+'.textContent.includes("M5 new evidence")'),false,'source retains its own root query');
      const after=await boot(a);assert.equal(after.discussionViews[identities.videoView].applied.text,'root');assert.equal(after.discussionViews[videoClone].applied.seen,'unseen');
      await invoke(a,'moveTab',{tabId:postClone,toIndex:0});
      // Closing all local video placements resumes the last used one, preserving the older dormant instance.
      await active(videoClone);await invoke(a,'closeTab',{tabId:identities.videoView});await invoke(a,'closeTab',{tabId:videoClone});
      await invoke(a,'openStoredItem',{itemId:identities.video});assert.equal((await boot(a)).workspace.activeTabId,videoClone);
      await wait(()=>js(a,panel(videoClone)+'.querySelector("input[type=search]")?.value==="video clone draft"'),'dormant state');
      await input(videoClone,'');await choose(videoClone,'select[name=seen]','all');await apply(videoClone);
      await js(a,'document.body.dispatchEvent(new KeyboardEvent("keydown",{key:"F3",bubbles:true,cancelable:true}));void 0');
      await wait(()=>js(a,'document.activeElement?.closest(".reader-panel")?.dataset.viewId==='+JSON.stringify(videoClone)),'video source navigation selection');
      await js(a,panel(videoClone)+'.scrollTop=11000;'+panel(videoClone)+'.dispatchEvent(new Event("scroll"));void 0');
      await wait(async()=>!!(await boot(a)).discussionViews[videoClone]?.anchor.commentId,'clone independent anchor persisted');
      assert.notEqual((await boot(a)).discussionViews[videoClone].anchor.commentId,(await boot(a)).discussionViews[identities.videoView].anchor.commentId,'different logical anchors');
      await input(videoClone,'video clone draft');
      const reopenedClone=await duplicate(videoClone);
      await js(a,'document.body.dispatchEvent(new KeyboardEvent("keydown",{key:"F3",bubbles:true,cancelable:true}));void 0');
      await wait(()=>js(a,'document.activeElement?.closest(".reader-panel")?.dataset.viewId==='+JSON.stringify(reopenedClone)),'independent duplicate navigation');
      await wait(async()=>{const state=await boot(a);return state.discussionViews[reopenedClone]?.selected!==state.discussionViews[videoClone]?.selected;},'independent selected comment committed');
      await js(a,panel(reopenedClone)+'.scrollTop=7000;'+panel(reopenedClone)+'.dispatchEvent(new Event("scroll"));void 0');
      await input(reopenedClone,'third independent draft');
      await invoke(a,'createBackup');await wait(()=>lifecycle.phase==='RELEASED'&&windows.participants().every(c=>!lifecycle.blocks(c)),'backup reconciled release');
      const saved=await boot(a), snapshot=ReaderRepository.open(backup);
      try { fs.writeFileSync(path.join(root,'checkpoint.json'),JSON.stringify(checkpoint(snapshot.bootstrap(['en'])))); } finally { snapshot.close(); }
      // Sealed global barriers reject structural creation after the participant set freezes.
      const drain=lifecycle.begin('backup');await drain;lifecycle.executePhase();
      const view=saved.viewInstances[reopenedClone];
      const blocked=await js(a,'window.reader.duplicateTab('+JSON.stringify({sourceViewId:reopenedClone,expectedRevision:saved.workspace.revision,intentRevision:view.intentRevision,collapseRevision:view.collapseRevision})+')');assert.equal(blocked.error.code,'DATA_BUSY');
      lifecycle.release();await wait(()=>lifecycle.phase==='RELEASED'&&windows.participants().every(c=>!lifecycle.blocks(c)),'barrier release');
      fs.writeFileSync(path.join(root,'live.json'),JSON.stringify(checkpoint(await boot(a))));
      await service.shutdown();a.destroy();b.destroy();console.log('M5 Electron PASS write: video/post duplicates, workers, DOM/focus, shared seen/guarded Undo/Refresh, reorder/dormancy, two authorized renderers, backup and sealed duplicate rejection.');
    }else{
      const saved=JSON.parse(fs.readFileSync(path.join(root,phase==='restart'?'live.json':'checkpoint.json'))), current=await boot(a);
      assert.deepEqual(current.workspace,saved.workspace);assert.deepEqual(current.discussionCollapse,saved.collapse);assert.deepEqual(current.viewInstances,saved.instances);
      for(const [id,intent]of Object.entries(saved.views)){assert.deepEqual(current.discussionViews[id],intent);}
      assert.deepEqual(current.comments,saved.comments);assert.deepEqual(current.seenUndo,saved.undo);
      for(const tab of current.workspace.tabs.filter(t=>t.kind==='discussion')){await active(tab.id);assert.equal(await js(a,panel(tab.id)+'.querySelector("input[type=search]").value'),saved.views[tab.id]?.draft.text??'');}
      console.log('M5 Electron PASS '+phase+': independent semantic/collapse/dormant identities, workspace order and shared state survive real process restart.');
      if(phase==='restart'){
        await invoke(a,'updatePreferences',{appearance:'dark'});
        const result=await invoke(a,'restoreBackup');assert.equal(result.status,'restarting');return;
      }
      // Deletion disposes every same-item mounted panel, including dormant SQL rows.
      await invoke(a,'removeLibraryItem',{itemId:identities.video});
      await wait(()=>js(a,'!Array.from(document.querySelectorAll("[data-item-id]")).some(e=>e.dataset.itemId==='+JSON.stringify(identities.video)+')'),'all duplicates removed');
      await service.shutdown();a.destroy();
    }
    clearTimeout(watchdog);app.quit();
  }).catch(fail);
}else{
  (async()=>{
    assert.ok(fs.existsSync(preload)&&fs.existsSync(page),'Build Forge first');
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'reader-m5-electron-'));
    try{
      const modules=['window-coordinator:WindowCoordinator','reader-service:ReaderService','reader-ipc:registerReaderIpc','persistence/reader-repository:ReaderRepository','extractors/yt-dlp:normalizeYtDlp','extractors/community:normalizeCommunityArchive'];
      const contents=modules.map(v=>{const[file,name]=v.split(':');return 'export {'+name+'} from '+JSON.stringify(path.resolve(__dirname,'../src/main',file+'.ts'))+';';}).join('\n');
      require('esbuild').buildSync({stdin:{contents,resolveDir:path.resolve(__dirname,'..'),loader:'ts'},bundle:true,platform:'node',format:'cjs',external:['electron'],outfile:path.join(root,'tools.cjs')});
      require('esbuild').buildSync({stdin:{contents:modules.filter(v=>v.startsWith('persistence/')||v.startsWith('extractors/')).map(v=>{const[file,name]=v.split(':');return 'export {'+name+'} from '+JSON.stringify(path.resolve(__dirname,'../src/main',file+'.ts'))+';';}).join('\n'),resolveDir:path.resolve(__dirname,'..'),loader:'ts'},bundle:true,platform:'node',format:'cjs',outfile:path.join(root,'seed.cjs')});
      const {ReaderRepository,normalizeYtDlp,normalizeCommunityArchive}=require(path.join(root,'seed.cjs'));
      const repo=ReaderRepository.open(path.join(root,'profile','reader.sqlite'));
      try {
      const video=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../src/main/extractors/__fixtures__/yt-nested-a.json'))),post=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../src/main/extractors/__fixtures__/community-thread-a.json')));
      video.raw.comments.push(...Array.from({length:400},(_,i)=>({id:'M5-flat-'+i,parent:'root',text:'M5 root conversation '+i,timestamp:1790856000+i})));
      const v=repo.ingest(normalizeYtDlp(JSON.stringify(video.raw),video.context),undefined,true).itemId,p=repo.ingest(normalizeCommunityArchive(JSON.stringify(post.raw),post.context),undefined,true).itemId;
      repo.updatePreferences({locale:'en'},['en']);const state=repo.bootstrap(['en']);
      fs.writeFileSync(path.join(root,'ids.json'),JSON.stringify({video:v,post:p,videoView:state.workspace.tabs.find(t=>t.itemId===v).id,postView:state.workspace.tabs.find(t=>t.itemId===p).id}));
      } finally { repo.close(); }
      for(const phase of ['write','restart','restored']){
        const env={...process.env,M5_ROOT:root,M5_PHASE:phase};delete env.ELECTRON_RUN_AS_NODE;
        const child=spawn(require('electron'),[__filename],{env,stdio:'inherit',windowsHide:true});
        await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error('M5 '+phase+' exited '+code)));});
      }
    }catch(error){console.error(error);throw error;}finally{assert.ok(path.dirname(root)===os.tmpdir()&&path.basename(root).startsWith('reader-m5-electron-'));fs.rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
  })().catch(error=>{console.error(error);process.exitCode=1;});
}
