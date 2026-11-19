let files = [], mode = 'whale', latest = null;
const $ = id => document.getElementById(id);
document.querySelectorAll('.mode').forEach(button => button.addEventListener('click', () => {
  mode = button.dataset.mode; document.querySelectorAll('.mode').forEach(b => b.classList.toggle('selected', b === button));
  $('start').innerHTML = `Transcribe with ${mode[0].toUpperCase()+mode.slice(1)} <b>→</b>`;
}));
function addFiles(items) { for (const item of items) if (!files.some(f => f.path === item.path)) files.push(item); paintQueue(); }
async function browse() { addFiles(await window.transcriber.pickAudio()); }
$('browse').addEventListener('click', browse);
const dz = $('dropzone');
dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('drag'); });
dz.addEventListener('dragleave', () => dz.classList.remove('drag'));
dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('drag'); addFiles(Array.from(e.dataTransfer.files).map(f => ({path:f.path,name:f.name}))); });
function paintQueue() {
  $('queue').innerHTML = files.map((f,i)=>`<div class="queue-item"><span class="q-name">${escapeHtml(f.name)}</span><span class="q-state" id="state-${i}">READY</span><button class="q-remove" data-remove="${i}">×</button></div>`).join('');
  document.querySelectorAll('[data-remove]').forEach(b=>b.onclick=()=>{files.splice(+b.dataset.remove,1);paintQueue()}); $('start').disabled = !files.length;
}
function escapeHtml(s){return s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function formatTimestamp(seconds) {
  const total = Math.max(0, Math.floor(seconds || 0));
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  return h ? `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}` : `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}
function timestampedTranscript(result) {
  if (!Array.isArray(result.chunks) || !result.chunks.length) return result.text || '';
  return result.chunks.map(chunk => `[${formatTimestamp(chunk.start)}] ${chunk.text}`).join('\n');
}
window.transcriber.onProgress(p => { if(p.stage==='loading'||p.stage==='transcribing') $('start').textContent=p.message; });
window.transcriber.onAppUpdate(update => {
  const notice = $('updateNotice');
  if(update.state === 'error') return;
  const messages = {
    available: `Whale Local ${update.version} found · downloading in the background…`,
    downloading: `Whale Local update downloading · ${update.percent}%`,
    downloaded: 'Update downloaded · Whale Local will restart and install it automatically…',
    installing: 'Installing the Whale Local update · reopening shortly…'
  };
  notice.textContent = messages[update.state] || '';
  notice.classList.toggle('hidden', !notice.textContent);
});
$('start').addEventListener('click', async () => {
  $('result').classList.add('hidden'); $('start').disabled=true;
  for(let i=0;i<files.length;i++){
    const f=files[i]; const state=$(`state-${i}`); if(state) state.textContent='WORKING';
    try { latest=await window.transcriber.transcribe({file:f.path,mode,language:$('language').value}); if(state) state.textContent='DONE';
      $('transcript').textContent=timestampedTranscript(latest); $('resultMeta').textContent=`${f.name} · ${latest.language?.toUpperCase()||'LANGUAGE'} · ${Math.round(latest.duration||0)} sec · timestamps shown${latest.warning?' · ⚠ '+latest.warning:''}`;
      $('result').classList.remove('hidden'); $('openTxt').onclick=()=>window.transcriber.openFile(latest.txt); $('openSrt').onclick=()=>window.transcriber.openFile(latest.srt);
      if(latest.warning) alert(latest.warning);
    } catch(err) { if(state) state.textContent='ERROR'; alert(err.message); }
  }
  $('start').disabled=false; $('start').innerHTML=`Transcribe with ${mode[0].toUpperCase()+mode.slice(1)} <b>→</b>`;
});
 $('copy').onclick=async()=>{if(latest){await navigator.clipboard.writeText(timestampedTranscript(latest));$('copy').textContent='Copied';setTimeout(()=>$('copy').textContent='Copy text',1200)}};
