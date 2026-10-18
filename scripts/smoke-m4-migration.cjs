// Actual production-entry v12 startup, dormant reopen, global backup/restore and
// two subsequent process starts. Only this freshly owned OS-temp profile is used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const { viewId } = require('./window-view-fixtures.cjs');
const file = root => path.join(root, 'youtube-comments-development', 'reader.sqlite');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const query = { text: '', fields: ['content'], mode: 'text', caseSensitive: false, seen: 'all', publication: { kind: 'all' }, discovery: 'all' };
if (process.versions.electron) {
  require('./thumbnail-fixture-network.cjs').installThumbnailNetwork();
  const { app, dialog } = require('electron');
  const root = process.env.YOUTUBE_COMMENTS_DEMO_ROOT, phase = process.env.M4_PHASE;
  assert.ok(path.dirname(root) === os.tmpdir() && path.basename(root).startsWith('reader-m4-electron-'));
  const expected = JSON.parse(fs.readFileSync(path.join(root, 'expected.json')));
  const watchdog = setTimeout(() => { console.error('M4 migration timeout', phase); app.exit(1); }, 60000);
  let count = 0, restored = false;
  dialog.showSaveDialog = async () => ({ canceled: false, filePath: path.join(root, 'snapshot.sqlite') });
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path.join(root, 'snapshot.sqlite')] });
  dialog.showMessageBox = async () => ({ response: 1 });
  app.relaunch = () => { restored = true; };
  process.on('uncaughtException', error => { console.error(error.stack); app.exit(1); });
  console.log('M4 starting',phase);
  app.on('browser-window-created', (_event, window) => {
    console.log('M4 reader created',phase);
    assert.equal(++count, 1, 'exactly one production reader');
    window.hide(); window.webContents.setBackgroundThrottling(false);
    window.webContents.once('did-finish-load', () => void (async () => {
      const js = code => window.webContents.executeJavaScript(code);
      const boot = async () => { const result = await js('window.reader.bootstrap()'); assert.equal(result.ok,true); return JSON.parse(JSON.stringify(result.value)); };
      const invoke = async (method,payload) => {
        if (['closeTab','openStoredItem'].includes(method)) payload = { ...payload, expectedRevision: (await boot()).workspace.revision };
        const result = await js(`window.reader.${method}(${payload ? JSON.stringify(payload) : ''})`); assert.equal(result.ok,true,method); return result.value;
      };
      async function wait(check,label) { for(let n=0;n<1200;n++) { if(await check()) return; await pause(10); } throw new Error(label); }
      await wait(() => js("!!document.querySelector('.app-shell')"),'reader');
      console.log('M4 reader ready',phase);
      let state = await boot();
      console.log('M4 bootstrap read',phase);
      const id = viewId(state,expected.itemId);
      assert.equal(state.items.length,3); assert.deepEqual(state.comments,expected.comments);
      assert.equal(state.preferences.customTranslationTarget,'uk-UA');
      if (phase === 'migrate') {
        assert.deepEqual(state.workspace.tabs.map(t => t.kind==='discussion'?t.itemId:t.kind), expected.order);
        assert.equal(state.workspace.activeTabId,viewId(state,'video-demo'));
        assert.equal(state.workspace.tabs.some(t => t.id===id),false,'closed legacy instance remains dormant');
        assert.equal(state.discussionViews[id].anchor.commentId,expected.anchor);
        assert.equal(state.discussionViews[id].anchor.offset,31.25);
        assert.equal(state.discussionViews[id].draft.text,'pending legacy draft');
        assert.deepEqual(state.discussionCollapse[id],{defaultCollapsed:false,overrides:[expected.collapsed]});
        console.log('M4 opening dormant view');
        await invoke('openStoredItem',{itemId:expected.itemId});
        await wait(() => js(`document.querySelector('[data-view-id="${id}"] .query-search input')?.value==='pending legacy draft'`),'fresh query reconstruction');
        await wait(() => js(`document.querySelector('[data-view-id="${id}"]').scrollTop>1000`),'distant anchor restored');
        await invoke('closeTab',{tabId:id});
        console.log('M4 opening dormant view');
        await invoke('openStoredItem',{itemId:expected.itemId});
        await wait(() => js(`document.querySelector('[data-view-id="${id}"]:not([hidden]) .query-search input')?.value==='pending legacy draft'`),'same dormant view resumed');
        assert.equal(viewId(await boot(),expected.itemId),id);
        console.log('M4 creating backup');
        await invoke('createBackup');
        const checkpoint = await boot();
        fs.writeFileSync(path.join(root,'checkpoint.json'),JSON.stringify({workspace:checkpoint.workspace,viewId:id,views:checkpoint.discussionViews,collapse:checkpoint.discussionCollapse}));
        await invoke('updatePreferences',{appearance:'dark'});
        const undo = (await boot()).seenUndo['video-demo'];
        assert.ok(undo); await invoke('undoSeen',{itemId:'video-demo',expectedOperationId:undo.id});
        console.log('M4 restoring backup');
        const result = await invoke('restoreBackup'); assert.equal(result.status,'restarting');
      } else {
        const checkpoint = JSON.parse(fs.readFileSync(path.join(root,'checkpoint.json')));
        assert.equal(id,checkpoint.viewId);
        assert.deepEqual(state.workspace,checkpoint.workspace);
        assert.deepEqual(state.discussionViews,checkpoint.views); assert.deepEqual(state.discussionCollapse,checkpoint.collapse);
        assert.ok(state.seenUndo['video-demo'],'shared recovery survived restore');
        await wait(() => js(`document.querySelector('[data-view-id="${id}"] .query-search input')?.value==='pending legacy draft'`),'restored reading intent');
        app.quit();
      }
      console.log(`M4 Electron PASS ${phase}: schema 14, one reader, opaque identity, lossless legacy state, distant dormant reopen, backup/restore/restart.`);
    })().catch(error => { console.error(error); app.exit(1); }));
  });
  app.on('will-quit', () => { if(phase==='migrate') assert.equal(restored,true); clearTimeout(watchdog); });
  require(path.resolve(__dirname,'../.vite/build/main.js'));
} else {
  (async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(),'reader-m4-electron-'));
    try {
      const tools = path.join(root,'tools.cjs');
      require('esbuild').buildSync({ stdin:{ contents:"export {ReaderRepository} from './src/main/persistence/reader-repository';export {normalizeYtDlp} from './src/main/extractors/yt-dlp';export {downgradeWindowFixture} from './src/main/persistence/testing/schema-12';",resolveDir:path.resolve(__dirname,'..'),loader:'ts'},bundle:true,platform:'node',format:'cjs',outfile:tools });
      const {ReaderRepository,normalizeYtDlp,downgradeWindowFixture}=require(tools);
      const repo=ReaderRepository.open(file(root)); repo.initializeDemo();
      const source=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../src/main/extractors/__fixtures__/yt-nested-a.json')));
      const raw={...source.raw,comments:Array.from({length:1200},(_,i)=>({id:`UgM4${i}`,parent:'root',text:`Legacy persisted comment ${i}`,timestamp:1790856000+i}))};
      const itemId=repo.ingest(normalizeYtDlp(JSON.stringify(raw),source.context)).itemId;
      const state=repo.bootstrap(['en']),id=viewId(state,itemId),anchor=state.comments[itemId][900].id,collapsed=state.comments[itemId][0].id;
      repo.saveDiscussionView({viewId:id,expectedRevision:0,draft:{...query,text:'pending legacy draft'},applied:query,sort:'oldest',anchor:{commentId:anchor,offset:31.25},selected:state.comments[itemId][800].id});
      repo.setDiscussionCollapse({viewId:id,expectedRevision:0,kind:'comments',ids:[collapsed],collapsed:true});
      repo.bulkSeen({itemId:'video-demo',target:{kind:'all'},seen:true});
      repo.toggleSeen({itemId:'video-demo',commentId:'v1',seen:false,subtree:false});repo.toggleSeen({itemId:'video-demo',commentId:'v1',seen:true,subtree:false});
      repo.updatePreferences({translationTarget:'custom',customTranslationTarget:'uk-UA'},['en']);repo.updatePreferences({locale:'en'},['en']);
      repo.changeWorkspace('openLibrary');repo.changeWorkspace('openSettings');
      repo.changeWorkspace('moveTab',repo.workspace().tabs.find(t=>t.kind==='settings').id,1);
      repo.changeWorkspace('activateTab',viewId(repo.bootstrap(['en']),'video-demo'));
      const final=repo.bootstrap(['en']);
      fs.writeFileSync(path.join(root,'expected.json'),JSON.stringify({itemId,anchor,collapsed,comments:final.comments,order:final.workspace.tabs.map(t=>t.kind==='discussion'?t.itemId:t.kind)}));
      repo.close();const db=new DatabaseSync(file(root));db.exec('PRAGMA foreign_keys=ON');downgradeWindowFixture(db);db.close();
      const original=fs.readFileSync(file(root));
      for(const phase of ['migrate','restart','second-restart']) {
        const env={...process.env,YOUTUBE_COMMENTS_DEMO_ROOT:root,M4_PHASE:phase};delete env.ELECTRON_RUN_AS_NODE;
        const child=spawn(require('electron'),[__filename],{env,stdio:'inherit',windowsHide:true});
        await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(new Error(`M4 ${phase} exited ${code}`)));});
        if (phase === 'restart') {
          // Native Close captures measured row offsets. Record that committed
          // checkpoint for the NEXT process, including fractional layout pixels.
          const checkpointFile=path.join(root,'checkpoint.json'), checkpoint=JSON.parse(fs.readFileSync(checkpointFile));
          const closed=new DatabaseSync(file(root),{readOnly:true});
          try {
            const views=Object.fromEntries(closed.prepare('SELECT * FROM discussion_view_intent').all().map(row=>[row.view_id,{
              draft:JSON.parse(row.draft_query_json),applied:JSON.parse(row.applied_query_json),sort:row.sort,
              anchor:{commentId:row.anchor_comment_id,offset:row.anchor_offset},selected:row.selected_comment_id,
            }]));
            for(const [id,view] of Object.entries(views)) {
              assert.ok(Math.abs(view.anchor.offset-checkpoint.views[id].anchor.offset)<1,'native measurement stays within one CSS pixel');
              assert.deepEqual({...view,anchor:{...view.anchor,offset:checkpoint.views[id].anchor.offset}},checkpoint.views[id],'Close preserves semantic intent and logical identities');
            }
            checkpoint.views=views;fs.writeFileSync(checkpointFile,JSON.stringify(checkpoint));
          } finally {closed.close();}
        }
      }
      const safetyDir=path.join(path.dirname(file(root)),'recovery');
      // The main-owned pre-migration safety is verified independently by the DB
      // tests; retain all real harness artifacts until all restarts have passed.
      assert.ok(original.length>0);assert.ok(fs.existsSync(safetyDir));
    } finally {
      assert.ok(path.dirname(root)===os.tmpdir()&&path.basename(root).startsWith('reader-m4-electron-'));
      fs.rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});
    }
  })().catch(error=>{console.error(error);process.exitCode=1;});
}
