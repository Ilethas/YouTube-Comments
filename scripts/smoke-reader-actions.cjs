const { tabElement, viewId } = require('./window-view-fixtures.cjs');
// Disposable built-entry Electron interaction regression. The browser seam captures
// destinations; it never sends fixture text to Google or changes the default browser.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const mixed = '你好，世界! 한국어 댓글 🦊 & ? + = %\nSecond line — Zażółć gęślą jaźń.';
const sourceId = 'UgxActionComment0123456789';
const channelId = 'UC' + 'a'.repeat(22);

if (process.versions.electron) {
  require('./thumbnail-fixture-network.cjs').installThumbnailNetwork();
  const { app, shell, ipcMain } = require('electron');
  const rejected = [], handle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (channel, handler) => handle(channel, async (...args) => {
    const result = await handler(...args);
    if (result?.ok === false) { rejected.push({ channel, code: result.error?.code }); if (rejected.length > 12) rejected.shift(); }
    return result;
  });
  const opened = [];
  shell.openExternal = async url => { opened.push(url); };
  const root = process.env.YOUTUBE_COMMENTS_DEMO_ROOT;
  let step = 'launch';
  // Large-profile bootstrap/clone time is measured separately (Q-21). This is a
  // hang guard, consistent with the existing large backup/restoration harnesses.
  const watchdog = setTimeout(() => { console.error('Reader action smoke timed out at '+step); app.exit(1); }, 180000);
  app.on('will-quit', () => clearTimeout(watchdog));
  app.on('browser-window-created', (_event, window) => {
    window.hide(); const contents = window.webContents; contents.setBackgroundThrottling(false);
    contents.once('did-finish-load', () => verify().then(() => {
      step = 'controlled Quit'; app.quit();
      setTimeout(async () => {
        try { console.error('Reader action Quit did not finish', { rejected, lifecycle: await contents.executeJavaScript('window.reader.lifecycle.current()'), alerts: await contents.executeJavaScript('Array.from(document.querySelectorAll("[role=alert]")).map(e=>e.textContent)') }); } catch { /* Process may already be closing. */ }
        app.exit(1);
      }, 25000);
    }).catch(error => {
      // Assertions never print captured URLs or translated text.
      console.error('Reader action smoke:', error.message.split('\n')[0]);
      console.error(error.stack.split('\n').filter(line=>line.trimStart().startsWith('at ')).slice(0,2).join('\n'));
      clearTimeout(watchdog); app.exit(1);
    }));
    async function verify() {
      step = 'bootstrap';
      const js = async code => {
        try { return await contents.executeJavaScript(code); }
        catch { throw new Error('Renderer expression failed at '+step); }
      };
      async function wait(code, label) { for (let i=0;i<400;i++) { if (await js(code)) return; await pause(30); } throw new Error('Timeout: '+label); }
      await wait("!!document.querySelector('.comment')", 'reader');
      const before = await js('window.reader.bootstrap().then(r=>r.ok ? {ok:true,value:{items:r.value.items,preferences:r.value.preferences,comments:Object.fromEntries(Object.entries(r.value.comments).map(([id,rows])=>[id,rows.slice(0,4)]))}} : r)'); assert.equal(before.ok, true);
      const item = before.value.items.find(item => item.sourceId === 'VidDemo_001');
      const comment = before.value.comments[item.id].find(comment => comment.source.commentId === sourceId);
      assert.equal(comment.author.displayName, '@Creator');
      assert.equal(comment.author.handle, '@creator');
      assert.equal(comment.author.sourceId, channelId);
      const article = `Array.from(document.querySelectorAll('[role=tabpanel]:not([hidden]) article.comment')).find(row=>row.dataset.domainCommentId===${JSON.stringify(comment.id)})`;
      const seen = () => {
        // Main-side test inspection only. Never expose SQL to the renderer or
        // repeatedly serialize the complete 50k bootstrap just to check four rows.
        const {DatabaseSync}=require('node:sqlite');
        const db=new DatabaseSync(path.join(root,'youtube-comments-development','reader.sqlite'),{readOnly:true});
        try { return db.prepare('SELECT s.seen FROM comments c JOIN comment_state s ON s.comment_id=c.id WHERE c.item_id=? ORDER BY c.position LIMIT 4').all(item.id).map(row=>!!row.seen); }
        finally { db.close(); }
      };
      const originalSeen = await seen();
      const selected = await js(`${article}.dataset.selected`);
      const mounted = await js("Number(document.querySelector('.virtual-reader').dataset.mountedCount)");
      assert.ok(mounted < 100, '50k discussion stays bounded');
      assert.equal(opened.length,0,'Nothing opens automatically');
      async function preference(index, value) {
        const selector = index === 2 ? '.translation-settings select' : index === 1 ? '.appearance-settings > label select' : '.preferences > label select';
        step = `preference ${index} ${value}`;
        console.log('Checking '+step);
        await js('document.getElementById("settings-toggle").click()');
        await wait("document.getElementById('panel-settings')?.hidden===false && document.querySelectorAll('.preferences select')[0]?.disabled===false && !document.getElementById('settings-toggle').disabled", 'settings');
        step += ' change';
        await js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
        await pause(50);
        await wait(`document.querySelector(${JSON.stringify(selector)})?.disabled===false && document.querySelector(${JSON.stringify(selector)}).value===${JSON.stringify(value)}`, 'saved preference');
        step += ' return';
        await js(`${tabElement(item.id)}.click()`);
        await wait(`document.querySelector(${JSON.stringify('[data-item-id="'+item.id+'"]')})?.hidden===false && ${article}!==null && !document.getElementById('settings-toggle').disabled`, 'discussion');
      }
      if (process.env.READER_ACTION_PHASE === 'read') {
        assert.equal(before.value.preferences.translationTarget,'de'); assert.equal(before.value.preferences.locale,'pl');
        assert.equal(before.value.preferences.appearance,'dark');
        await js('document.getElementById("settings-toggle").click()');
        await wait("document.querySelector('.translation-settings select')?.value==='de'", 'restored German preference');
        // Finish the Settings activation and its lazy helper probes before this clean-Quit assertion.
        // Accepted queued mutation drains are exercised separately by the M3 Quit harness.
        await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
        await wait("!document.querySelector('.tabs button:disabled') && !document.querySelector('.helper-tool[aria-busy=true]')", 'Settings acknowledgments settled');
        assert.equal(opened.length,0); console.log('Reader action restart PASS: persisted German target, Polish/dark, no automatic browser request'); return;
      }
      async function activate(selector) {
        step = `activate ${selector}`;
        const count = opened.length;
        await js(`${article}.querySelector(${JSON.stringify(selector)}).click()`);
        for (let i=0;i<200 && opened.length===count;i++) await pause(20);
        assert.equal(opened.length,count+1, 'Browser command reached main once');
        await wait(`!${article}.querySelector(${JSON.stringify(selector)}).disabled`, 'action settled');
      }
      await preference(0,'en'); await preference(1,'light');
      const byline = await js(`(()=>{const a=${article};return {name:a.querySelector('.action-author button').textContent,handle:a.querySelector('.comment-byline > .muted')?.textContent};})()`);
      assert.equal(byline.name, '@Creator');
      assert.equal(byline.handle, undefined, 'Equivalent handle is hidden while the primary author action remains');
      for (const [locale,theme] of [['en','light'],['pl','dark']]) {
        await preference(0,locale); await preference(1,theme);
        step = `creator ${theme}`;
        const colors = await js(`(()=>{const a=${article},e=a.querySelector('.creator-author');return {color:getComputedStyle(e).color,background:getComputedStyle(a).backgroundColor,badge:!!a.querySelector('.creator-badge')};})()`);
        assert.ok(colors.badge); assert.notEqual(colors.color,'rgb(0, 0, 0)');
        const ratio = await js(`(()=>{const s=getComputedStyle(document.documentElement),l=x=>{const v=x.trim().slice(1).match(/../g).map(c=>parseInt(c,16)/255).map(c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4);return .2126*v[0]+.7152*v[1]+.0722*v[2]},a=l(s.getPropertyValue('--creator'));return Math.min(...['--surface','--accent-soft'].map(k=>{const b=l(s.getPropertyValue(k));return (Math.max(a,b)+.05)/(Math.min(a,b)+.05)}));})()`);
        assert.ok(ratio>=4.5,'Creator text contrast in both row states');
        const diagnostics=path.resolve(__dirname,'../.packaging-diagnostics'); fs.mkdirSync(diagnostics,{recursive:true});
        window.showInactive(); await pause(120);
        fs.writeFileSync(path.join(diagnostics,`reader-actions-${theme}.png`),(await contents.capturePage()).toPNG()); window.hide();
        console.log(`Creator ${theme} minimum contrast: ${ratio.toFixed(2)}:1`);
      }
      await activate('.action-author button'); assert.equal(opened.at(-1),`https://www.youtube.com/channel/${channelId}`);
      await activate('.action-permalink button'); assert.equal(opened.at(-1),`https://www.youtube.com/watch?v=VidDemo_001&lc=${sourceId}`);
      assert.ok((await js(`${article}.querySelector('time').textContent`)).includes('weeks'),'Source approximate label is retained');
      for (const [locale,target,effective] of [['en','app','en'],['pl','app','pl'],['pl','en','en'],['pl','de','de'],['en','de','de']]) {
        await preference(0,locale); await preference(2,target); await activate('.action-translate button');
        const url = new URL(opened.at(-1)); assert.equal(url.origin,'https://translate.google.com');
        assert.equal(url.searchParams.get('sl'),'auto'); assert.equal(url.searchParams.get('tl'),effective);
        assert.equal(url.searchParams.get('text'),mixed);
      }
      assert.deepEqual(await seen(),originalSeen); assert.equal(await js(`${article}.dataset.selected`),selected);
      // Native browser pointer selection across author, timestamp and comment text.
      step = 'native selection';
      window.showInactive(); contents.focus();
      await js(`${article}.scrollIntoView({block:'center'})`);
      const points = await js(`(()=>{const a=${article},r=a.querySelector('strong').getBoundingClientRect(),s=a.querySelector('.comment-text').getBoundingClientRect();return {a:{x:Math.round(r.left+2),y:Math.round(r.top+6)},b:{x:Math.round(s.left+180),y:Math.round(s.top+7)}};})()`);
      const sends = opened.length;
      contents.sendInputEvent({type:'mouseDown',...points.a,button:'left',clickCount:1});
      contents.sendInputEvent({type:'mouseMove',...points.b});
      contents.sendInputEvent({type:'mouseUp',...points.b,button:'left',clickCount:1});
      await wait('!getSelection().isCollapsed && getSelection().anchorNode!==getSelection().focusNode','native cross-element selection');
      // Native Copy/clipboard restoration is covered once in smoke-electron.
      // Here selection specifically begins inside the linked author control.
      step = 'native Shift extension';
      contents.sendInputEvent({type:'mouseDown',x:points.b.x+30,y:points.b.y,button:'left',clickCount:1,modifiers:['shift']});
      contents.sendInputEvent({type:'mouseUp',x:points.b.x+30,y:points.b.y,button:'left',clickCount:1,modifiers:['shift']});
      await pause(80); assert.equal(opened.length,sends); assert.deepEqual(await seen(),originalSeen);
      await js('getSelection().removeAllRanges()'); window.hide();
      // Real CSS reduced-motion behavior (text stage remains in the existing smoke).
      step = 'reduced motion';
      contents.debugger.attach('1.3');
      try {
        await js("(()=>{const e=document.createElement('span');e.id='spinner-probe';e.className='acquisition-spinner';document.body.append(e);})()");
        await contents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
        assert.equal(await js("getComputedStyle(document.getElementById('spinner-probe')).animationName"),'acquisition-spin');
        await contents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
        assert.equal(await js("getComputedStyle(document.getElementById('spinner-probe')).animationName"),'acquisition-spin');
        await js("document.getElementById('spinner-probe').remove()");
      } finally { contents.debugger.detach(); }
      await preference(0,'pl'); await preference(1,'dark'); await preference(2,'de');
      console.log(`Reader actions PASS: creator EN/light PL/dark; channel/comment intents; Unicode translation EN/PL/DE; native linked-text selection; reduced motion; 50k rows mounted=${mounted}. Browser seam captured, no outbound translation.`);
    }
  });
  require(path.resolve(__dirname,'../.vite/build/main.js'));
} else {
  (async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(),'reader-actions-electron-'));
    try {
      const toolsFile=path.join(root,'tools.cjs');
      require('esbuild').buildSync({stdin:{contents:`export {ReaderRepository} from ${JSON.stringify(path.resolve(__dirname,'../src/main/persistence/reader-repository.ts'))};export {normalizeYtDlp} from ${JSON.stringify(path.resolve(__dirname,'../src/main/extractors/yt-dlp.ts'))};`,resolveDir:path.resolve(__dirname,'..'),loader:'ts'},bundle:true,platform:'node',format:'cjs',outfile:toolsFile});
      const {ReaderRepository,normalizeYtDlp}=require(toolsFile);
      const repo=ReaderRepository.open(path.join(root,'youtube-comments-development','reader.sqlite'));
      const fixture=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../src/main/extractors/__fixtures__/yt-nested-a.json'),'utf8'));
      const raw={...fixture.raw,comments:Array.from({length:50000},(_,i)=>({id:i===0?sourceId:`UgGenerated${String(i).padStart(10,'0')}`,parent:'root',text:i===0?mixed:`Generated row ${i}`,author:i===0?'@Creator':'Reader',author_url:i===0?'https://www.youtube.com/@creator':undefined,author_id:i===0?channelId:undefined,author_is_uploader:i===0,timestamp:1758000000,_time_text:'about 2 weeks ago'}))};
      repo.ingest(normalizeYtDlp(JSON.stringify(raw),fixture.context),undefined,true); repo.close();
      for (const phase of ['write','read']) {
        const env={...process.env,YOUTUBE_COMMENTS_DEMO_ROOT:root,READER_ACTION_PHASE:phase}; delete env.ELECTRON_RUN_AS_NODE;
        const child=spawn(require('electron'),[__filename],{env,stdio:'inherit',windowsHide:true});
        await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(new Error(`Reader action ${phase} failed (${code})`)));});
      }
    } finally {
      if(path.dirname(root)!==os.tmpdir() || !path.basename(root).startsWith('reader-actions-electron-')) throw new Error('Unsafe cleanup');
      fs.rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});
    }
  })().catch(error=>{console.error(error.message);process.exitCode=1;});
}
