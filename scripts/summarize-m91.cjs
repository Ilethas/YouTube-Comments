// Read only local benchmark artifacts; no profile or application access.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const directory = path.resolve(__dirname, '../.packaging-diagnostics/m91');
const range = values => {
  const rows = values.filter(Number.isFinite).sort((a,b)=>a-b);
  const middle=Math.floor(rows.length/2);
  return rows.length ? { n:rows.length,min:rows[0],median:rows.length%2 ? rows[middle] : (rows[middle-1]+rows[middle])/2,max:rows.at(-1) } : undefined;
};
function summarize(label) {
  assert.match(label,/^[a-z0-9-]+$/);
  const data=JSON.parse(fs.readFileSync(path.join(directory,label+'.json')));
  return { label,build:data.build,windows:[2,3,4].flatMap(windows=>{
    const samples=data.runs.filter(r=>r.windows===windows&&r.phase.startsWith('sample'));
    const stress=data.runs.find(r=>r.windows===windows&&r.phase==='stress');
    if(!samples.length&&!stress)return [];
    const first=samples[0]??stress,materialization=first.materialization;
    return [{windows,startupMs:range(samples.map(r=>Math.max(...r.usableMs))),
      mainRssMiB:range(samples.map(r=>r.measurements[0].mainMemory.rss/2**20)),
      rendererHeapMiB:range(samples.flatMap(r=>r.measurements[0].renderers.map(v=>v.heap.usedSize/2**20))),
      rendererWorkingSetMiB:range(samples.flatMap(r=>r.measurements[0].processes.filter(p=>p.type==='Tab').map(p=>p.memory.workingSetSize/1024))),
      mainLoopMaxMs:range(samples.map(r=>r.measurements[0].mainLoop.maxMs)),
      workerRoundtripMs:range(samples.flatMap(r=>r.measurements[0].renderers.flatMap(v=>v.probe.workers.map(p=>p.roundtripMs)))),
      bootstrap:materialization.snapshots??materialization,algorithms:materialization.algorithms,
      operations:stress?.operations,stressIpc:stress?.ipc,stressNotifications:stress?.notifications,
      stressMeasurements:stress?.measurements.map(m=>({label:m.label,mainRssMiB:m.mainMemory.rss/2**20,rendererHeapMiB:m.renderers.map(v=>v.heap.usedSize/2**20),mainLoop:m.mainLoop})),
      phases:data.runs.filter(r=>r.windows===windows).map(r=>r.phase)}];
  })};
}
const summaries=process.argv.slice(2).map(summarize);
assert.ok(summaries.length,'Pass one or more report labels');
const value=JSON.stringify(summaries,null,2);
fs.writeFileSync(path.join(directory,'comparison.json'),value);
console.log(value);
