let demandas = [];
let clientesBase = [];
let currentUser = null;
let dragIndex = null;
let canDeleteFlag = false;

const STATUS_LIST = ['Todos','Em Andamento','Concluído','Pendentes','Paralisado'];

async function api(url, options={}){
  const resp = await fetch(url, {
    headers: {'Content-Type':'application/json', ...(options.headers||{})},
    credentials: 'same-origin',
    ...options
  });
  const data = await resp.json().catch(()=>({ok:false,error:'Resposta inválida do servidor.'}));
  if(!resp.ok || data.ok === false){ throw new Error(data.error || 'Erro na operação.'); }
  return data;
}

function normalizeText(v){
  return String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ').trim().toLowerCase();
}
function statusSeguro(v){
  const s=normalizeText(v);
  if(['concluido','concluida','finalizado','finalizada'].includes(s)) return 'Concluído';
  if(['pendente','pendentes','pendencia'].includes(s)) return 'Pendentes';
  if(['paralisado','parada','pausado','pausada'].includes(s)) return 'Paralisado';
  return 'Em Andamento';
}
function fmtDate(v){ if(!v) return ''; const [y,m,d]=String(v).split('-'); if(!y||!m||!d) return String(v); return `${d}/${m}/${y}`; }
function today(){ return new Date().toISOString().slice(0,10); }
function escapeHtml(v){ return String(v||'').replace(/[&<>'"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
function prazoClass(prazo,status){ if(status==='Concluído' || !prazo) return ''; const p = new Date(prazo+'T00:00:00'); const now = new Date(); now.setHours(0,0,0,0); const diff=(p-now)/86400000; if(diff<0) return 'overdue'; if(diff<=2) return 'soon'; return ''; }
function toastMsg(msg){ const t=document.getElementById('toast'); t.textContent=msg; t.classList.add('show'); setTimeout(()=>t.classList.remove('show'),2600); }

async function init(){
  try{
    clientesBase = await fetch('/static/clientes.json').then(r=>r.json());
  }catch(e){ clientesBase=[]; }
  initInteractiveBackground();
  await checkSession();
}
async function checkSession(){
  const me = await api('/api/me');
  if(me.logged){
    currentUser = me.user;
    applyAuth(true);
    await carregarDemandas();
  }else{
    applyAuth(false);
  }
}
function applyAuth(logged){
  document.getElementById('loginScreen').classList.toggle('hidden', logged);
  document.getElementById('appShell').classList.toggle('hidden', !logged);
  if(logged){
    document.getElementById('usuarioLogado').textContent = currentUser.username.toUpperCase();
    const perfil=document.getElementById('perfilUsuario');
    perfil.textContent = currentUser.role === 'admin' ? 'ADMIN' : 'USUÁRIO';
    perfil.className = currentUser.role === 'admin' ? 'role-admin' : 'role-user';
  }
}
function loginKey(e){ if(e.key==='Enter') login(); }
async function login(){
  const username = document.getElementById('loginUser').value.trim().toLowerCase();
  const password = document.getElementById('loginPass').value;
  try{
    const data = await api('/api/login', {method:'POST', body:JSON.stringify({username,password})});
    currentUser = data.user;
    document.getElementById('loginPass').value='';
    document.getElementById('loginError').textContent='';
    applyAuth(true);
    await carregarDemandas();
    toastMsg('Login realizado com sucesso.');
  }catch(err){ document.getElementById('loginError').textContent = err.message; }
}
async function logout(){ await api('/api/logout', {method:'POST'}); currentUser=null; demandas=[]; applyAuth(false); }

async function carregarDemandas(){
  const data = await api('/api/demandas');
  canDeleteFlag = !!data.can_delete;
  demandas = data.demandas.map(d=>({
    id:d.id,
    id_prioridade:d.id_prioridade,
    cliente:d.cliente,
    data:d.data,
    melhoria:d.melhoria,
    observacao:d.observacao,
    responsavel:d.responsavel,
    prazo:d.prazo,
    status:statusSeguro(d.status)
  }));
  atualizarCombosCliente();
  render();
}
function clientesDisponiveis(){
  const extras=demandas.map(d=>d.cliente).filter(Boolean);
  const vistos=new Set();
  const lista=[];
  [...clientesBase,...extras].forEach(item=>{
    const chave=normalizeText(item);
    if(!vistos.has(chave)){ vistos.add(chave); lista.push(item); }
  });
  return lista.sort((a,b)=>a.localeCompare(b,'pt-BR'));
}
function preencherSelectCliente(select, {filtro=false}={}){
  if(!select) return;
  const atual=select.value;
  const lista=clientesDisponiveis();
  let html=filtro?'<option value="Todos">Todos</option>':'<option value="">Selecione...</option>';
  html += lista.map(c=>`<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
  select.innerHTML=html;
  if([...select.options].some(o=>o.value===atual)) select.value=atual;
  else select.value=filtro?'Todos':'';
}
function atualizarCombosCliente(){ preencherSelectCliente(document.getElementById('fCliente'),{filtro:true}); preencherSelectCliente(document.getElementById('cliente'),{filtro:false}); }
function filtered(){
  const b=document.getElementById('busca').value.toLowerCase().trim();
  const fs=document.getElementById('fStatus').value;
  const fc=document.getElementById('fCliente').value;
  const fr=document.getElementById('fResponsavel').value.toLowerCase().trim();
  return demandas.filter(d =>
    (fs==='Todos' || d.status===fs) &&
    (fc==='Todos' || d.cliente===fc) &&
    (!fr || d.responsavel.toLowerCase().includes(fr)) &&
    (!b || [d.cliente,d.melhoria,d.observacao,d.responsavel,d.status].join(' ').toLowerCase().includes(b))
  );
}
function renderKpis(){
  kTotal.textContent=demandas.length;
  kAndamento.textContent=demandas.filter(d=>d.status==='Em Andamento').length;
  kConcluido.textContent=demandas.filter(d=>d.status==='Concluído').length;
  kPendente.textContent=demandas.filter(d=>d.status==='Pendentes').length;
  kParalisado.textContent=demandas.filter(d=>d.status==='Paralisado').length;
  const fs=document.getElementById('fStatus')?.value || 'Todos';
  document.querySelectorAll('[data-status-card]').forEach(card=>card.classList.toggle('active', card.dataset.statusCard===fs));
}
function renderTabs(){
  const fs=document.getElementById('fStatus').value;
  document.getElementById('tabs').innerHTML=STATUS_LIST.map(s=>{
    const qtd=s==='Todos'?demandas.length:demandas.filter(d=>d.status===s).length;
    return `<button class="tab ${s==='Concluído'?'tab-concluido':''} ${fs===s?'active':''}" onclick="setStatus('${s}')">${s} · ${qtd}</button>`;
  }).join('');
}
function render(){
  renderKpis(); renderTabs();
  const data=filtered();
  const tbody=document.getElementById('tbody');
  if(!data.length){ tbody.innerHTML=`<tr><td colspan="10" class="empty">Nenhuma demanda encontrada para os filtros aplicados.</td></tr>`; return; }
  tbody.innerHTML=data.map(d=>{
    const globalIndex=demandas.findIndex(x=>x.id===d.id);
    return `<tr class="${d.status==='Concluído'?'row-concluido':''}" draggable="true" ondragstart="dragStart(event,${globalIndex})" ondragover="dragOver(event)" ondrop="dropRow(event,${globalIndex})" ondragend="dragEnd(event)">
      <td class="drag">⋮⋮</td>
      <td><span class="pid">${d.id_prioridade}</span></td>
      <td>${escapeHtml(d.cliente)}</td>
      <td>${fmtDate(d.data)}</td>
      <td class="title-cell">${escapeHtml(d.melhoria)}</td>
      <td><div class="obs">${escapeHtml(d.observacao)}</div></td>
      <td>${escapeHtml(d.responsavel)}</td>
      <td class="${prazoClass(d.prazo,d.status)}">${fmtDate(d.prazo)}</td>
      <td><select class="mini" onchange="alterarStatusRapido(${d.id}, this.value)"><option ${d.status==='Em Andamento'?'selected':''}>Em Andamento</option><option ${d.status==='Concluído'?'selected':''}>Concluído</option><option ${d.status==='Pendentes'?'selected':''}>Pendentes</option><option ${d.status==='Paralisado'?'selected':''}>Paralisado</option></select></td>
      <td><div class="row-actions"><button class="mini" onclick="editar(${d.id})">Editar</button>${canDeleteFlag?`<button class="mini danger" onclick="excluir(${d.id})">Excluir</button>`:''}</div></td>
    </tr>`;
  }).join('');
}
function setStatus(s){ document.getElementById('fStatus').value=s; render(); }
function limparFiltros(){ busca.value=''; fStatus.value='Todos'; fCliente.value='Todos'; fResponsavel.value=''; render(); }
function abrirModal(){
  editId.value=''; modalTitle.textContent='Nova demanda'; data.value=today(); prazo.value=''; melhoria.value=''; observacao.value=''; responsavel.value=''; status.value='Em Andamento';
  atualizarCombosCliente();
  const filtroCliente=document.getElementById('fCliente').value;
  cliente.value=(filtroCliente && filtroCliente!=='Todos')?filtroCliente:'';
  modal.classList.add('open');
}
function fecharModal(){ modal.classList.remove('open'); }
function payloadModal(){ return {cliente:cliente.value||'Não informado', data:data.value||today(), melhoria:melhoria.value.trim(), observacao:observacao.value.trim(), responsavel:responsavel.value.trim(), prazo:prazo.value, status:status.value}; }
async function salvarDemanda(){
  if(!melhoria.value.trim() || !responsavel.value.trim()){ toastMsg('Preencha pelo menos Melhoria e Responsável.'); return; }
  const payload=payloadModal();
  try{
    if(editId.value){ await api(`/api/demandas/${editId.value}`, {method:'PUT', body:JSON.stringify(payload)}); }
    else { await api('/api/demandas', {method:'POST', body:JSON.stringify(payload)}); }
    fecharModal();
    await carregarDemandas();
    toastMsg('Demanda salva com sucesso.');
  }catch(err){ toastMsg(err.message); }
}
function editar(id){
  const d=demandas.find(x=>x.id===id); if(!d) return;
  atualizarCombosCliente();
  editId.value=d.id; modalTitle.textContent=`Editar demanda #${d.id_prioridade}`;
  cliente.value=d.cliente; data.value=d.data; prazo.value=d.prazo; melhoria.value=d.melhoria; observacao.value=d.observacao; responsavel.value=d.responsavel; status.value=d.status;
  modal.classList.add('open');
}
async function alterarStatusRapido(id, novoStatus){
  try{ await api(`/api/demandas/${id}/status`, {method:'PUT', body:JSON.stringify({status:novoStatus})}); await carregarDemandas(); toastMsg('Status atualizado com sucesso.'); }
  catch(err){ toastMsg(err.message); }
}
async function excluir(id){
  if(!canDeleteFlag){ toastMsg('Exclusão liberada apenas para Admin.'); return; }
  if(!confirm('Arquivar esta demanda? Ela não será apagada definitivamente.')) return;
  try{ await api(`/api/demandas/${id}`, {method:'DELETE'}); await carregarDemandas(); toastMsg('Demanda arquivada com histórico preservado.'); }
  catch(err){ toastMsg(err.message); }
}
function dragStart(e,index){ dragIndex=index; e.currentTarget.classList.add('dragging'); }
function dragOver(e){ e.preventDefault(); }
async function dropRow(e,targetIndex){
  e.preventDefault();
  if(dragIndex===null || dragIndex===targetIndex) return;
  const item=demandas.splice(dragIndex,1)[0]; demandas.splice(targetIndex,0,item);
  demandas.forEach((d,i)=>d.id_prioridade=i+1);
  render();
  try{ await api('/api/reordenar', {method:'PUT', body:JSON.stringify({order:demandas.map(d=>d.id)})}); await carregarDemandas(); toastMsg('Prioridade salva no banco.'); }
  catch(err){ toastMsg(err.message); await carregarDemandas(); }
}
function dragEnd(e){ e.currentTarget.classList.remove('dragging'); dragIndex=null; }

function normalizarCabecalho(v){ return String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim().replace(/[^a-z0-9]/g,''); }
function pegarCampo(row, nomes){ const keys=Object.keys(row||{}); for(const nome of nomes){ const alvo=normalizarCabecalho(nome); const key=keys.find(k=>normalizarCabecalho(k)===alvo); if(key!==undefined) return row[key]; } return ''; }
function normalizarDataImportacao(v){
  if(!v) return '';
  if(v instanceof Date && !isNaN(v)) return v.toISOString().slice(0,10);
  const s=String(v).trim();
  const br=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); if(br) return `${br[3]}-${String(br[2]).padStart(2,'0')}-${String(br[1]).padStart(2,'0')}`;
  const iso=s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); if(iso) return `${iso[1]}-${String(iso[2]).padStart(2,'0')}-${String(iso[3]).padStart(2,'0')}`;
  return '';
}
function parseCSV(texto){
  const linhas=[]; let atual='', linha=[], aspas=false;
  for(let i=0;i<texto.length;i++){
    const c=texto[i], prox=texto[i+1];
    if(c==='"' && aspas && prox==='"'){ atual+='"'; i++; continue; }
    if(c==='"'){ aspas=!aspas; continue; }
    if((c===';' || c===',') && !aspas){ linha.push(atual); atual=''; continue; }
    if((c==='\n' || c==='\r') && !aspas){ if(c==='\r' && prox==='\n') i++; linha.push(atual); atual=''; if(linha.some(x=>String(x).trim()!=='')) linhas.push(linha); linha=[]; continue; }
    atual+=c;
  }
  linha.push(atual); if(linha.some(x=>String(x).trim()!=='')) linhas.push(linha);
  if(!linhas.length) return [];
  const header=linhas[0].map(h=>String(h||'').replace(/^\ufeff/,'').trim());
  return linhas.slice(1).map(cols=>{ const obj={}; header.forEach((h,i)=>obj[h]=cols[i]||''); return obj; });
}
function linhasParaDemandas(rows){
  const importadas=[];
  for(const row of rows){
    const melhoria=String(pegarCampo(row,['Melhoria','Titulo','Título','Demanda'])||'').trim();
    const responsavel=String(pegarCampo(row,['Responsável','Responsavel','Autor Responsável','Autor Responsavel','Autor'])||'').trim();
    const clienteValor=String(pegarCampo(row,['Cliente','Conta','Projeto'])||'').trim();
    if(!melhoria && !responsavel && !clienteValor) continue;
    importadas.push({
      cliente: clienteValor || 'Não informado',
      data: normalizarDataImportacao(pegarCampo(row,['Data','Data da inclusão','Data da inclusao'])) || today(),
      melhoria: melhoria || 'Demanda sem título',
      observacao: String(pegarCampo(row,['Observação','Observacao','Detalhe','Descrição','Descricao'])||'').trim(),
      responsavel: responsavel || 'Não informado',
      prazo: normalizarDataImportacao(pegarCampo(row,['Prazo','Prazo de finalização','Prazo de finalizacao','Data Prazo'])),
      status: statusSeguro(pegarCampo(row,['Status','Situação','Situacao']))
    });
  }
  return importadas;
}
async function concluirImportacao(rows){
  const novas=linhasParaDemandas(rows);
  if(!novas.length){ toastMsg('Nenhuma linha válida encontrada. Confira o layout do arquivo.'); return; }
  try{ const resp=await api('/api/importar', {method:'POST', body:JSON.stringify({rows:novas})}); await carregarDemandas(); toastMsg(`${resp.importadas} demanda(s) importada(s) com sucesso.`); }
  catch(err){ toastMsg(err.message); }
}
function importarArquivoMassivo(event){
  const file=event.target.files && event.target.files[0]; event.target.value=''; if(!file) return;
  const ext=file.name.split('.').pop().toLowerCase();
  if(ext==='csv'){ const reader=new FileReader(); reader.onload=e=>concluirImportacao(parseCSV(e.target.result)); reader.readAsText(file,'utf-8'); return; }
  if(!window.XLSX){ toastMsg('Biblioteca Excel não carregou. Conecte à internet para importar .xlsx.'); return; }
  const reader=new FileReader();
  reader.onload=e=>{ try{ const wb=XLSX.read(e.target.result,{type:'array',cellDates:true}); const ws=wb.Sheets[wb.SheetNames[0]]; const rows=XLSX.utils.sheet_to_json(ws,{defval:'',raw:false}); concluirImportacao(rows); }catch(err){ toastMsg('Não consegui ler o Excel. Confira se o arquivo segue o modelo.'); } };
  reader.readAsArrayBuffer(file);
}
function baixarModeloImportacao(){
  const header=['Id Prioridade','Cliente','Data','Melhoria','Observação','Responsável','Prazo','Status'];
  const exemplo=[1,'ENERGISA',fmtDate(today()),'Exemplo de melhoria','Detalhe da demanda','Gerber',fmtDate(today()),'Em Andamento'];
  const csv=[header,exemplo].map(r=>r.map(v=>'"'+String(v??'').replaceAll('"','""')+'"').join(';')).join('\n');
  const blob=new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8;'}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download='modelo_importacao_esteira_demandas.csv'; a.click(); URL.revokeObjectURL(url);
}
function exportarCSV(){
  const header=['Id Prioridade','Cliente','Data','Melhoria','Observação','Responsável','Prazo','Status'];
  const rows=demandas.map(d=>[d.id_prioridade,d.cliente,fmtDate(d.data),d.melhoria,d.observacao,d.responsavel,fmtDate(d.prazo),d.status]);
  const csv=[header,...rows].map(r=>r.map(v=>'"'+String(v??'').replaceAll('"','""')+'"').join(';')).join('\n');
  const blob=new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8;'}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download='esteira_demandas.csv'; a.click(); URL.revokeObjectURL(url);
}

function initInteractiveBackground(){
  const bg=document.getElementById('animatedBg'); const canvas=document.getElementById('networkCanvas'); const ctx=canvas.getContext('2d');
  const mouse={x:window.innerWidth/2,y:window.innerHeight/2,active:false}; let points=[];
  function resize(){ canvas.width=window.innerWidth*devicePixelRatio; canvas.height=window.innerHeight*devicePixelRatio; canvas.style.width=window.innerWidth+'px'; canvas.style.height=window.innerHeight+'px'; ctx.setTransform(devicePixelRatio,0,0,devicePixelRatio,0,0); const total=Math.min(95,Math.max(48,Math.floor(window.innerWidth/18))); points=Array.from({length:total},()=>({x:Math.random()*window.innerWidth,y:Math.random()*window.innerHeight,vx:(Math.random()-.5)*.34,vy:(Math.random()-.5)*.34,r:Math.random()*1.8+1})); }
  function movePointer(x,y){ mouse.x=x; mouse.y=y; mouse.active=true; bg.style.setProperty('--mx',x+'px'); bg.style.setProperty('--my',y+'px'); }
  window.addEventListener('resize',resize); window.addEventListener('mousemove',e=>movePointer(e.clientX,e.clientY)); window.addEventListener('touchmove',e=>{ if(e.touches[0]) movePointer(e.touches[0].clientX,e.touches[0].clientY); },{passive:true}); window.addEventListener('mouseleave',()=>mouse.active=false);
  function draw(){ ctx.clearRect(0,0,window.innerWidth,window.innerHeight); for(const p of points){ const dx=p.x-mouse.x, dy=p.y-mouse.y, dist=Math.hypot(dx,dy); if(dist<145){ p.x += dx/dist*.20 || 0; p.y += dy/dist*.20 || 0; } p.x+=p.vx; p.y+=p.vy; if(p.x<0||p.x>window.innerWidth) p.vx*=-1; if(p.y<0||p.y>window.innerHeight) p.vy*=-1; ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,Math.PI*2); ctx.fillStyle='rgba(143,210,255,.42)'; ctx.fill(); }
    for(let i=0;i<points.length;i++){ for(let j=i+1;j<points.length;j++){ const a=points[i], b=points[j], d=Math.hypot(a.x-b.x,a.y-b.y); if(d<118){ ctx.strokeStyle=`rgba(0,157,255,${(1-d/118)*.16})`; ctx.lineWidth=1; ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke(); } } const p=points[i], md=Math.hypot(p.x-mouse.x,p.y-mouse.y); if(md<190){ ctx.strokeStyle=`rgba(255,107,0,${(1-md/190)*.22})`; ctx.lineWidth=1; ctx.beginPath(); ctx.moveTo(p.x,p.y); ctx.lineTo(mouse.x,mouse.y); ctx.stroke(); } }
    requestAnimationFrame(draw); }
  resize(); draw();
}

document.addEventListener('DOMContentLoaded', init);
