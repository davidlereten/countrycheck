// CountryCheck Secure Roles V4. Supabase URL/key are fixed intentionally.
const SUPABASE_PROJECT_URL = "https://ftrxlqdjmtspvwupoiyq.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_ZJ0UnfPazyYwwOIYSzKw6Q_47n9n5E6";
const LOCAL_EMAIL_DOMAIN = "countrycheck.local";
let sb, session, profile, countries=[], documents=[], rules=[];
let currentView = "Checker";

const $ = (id)=>document.getElementById(id);
const flagUrl = code => code && code.length===2 ? `https://flagcdn.com/w40/${code.toLowerCase()}.png` : "";
const labelCountry = c => c ? `${c.name}` : "—";
const countryByCode = code => countries.find(c=>c.code===code);
const isProvided = v => v && !String(v).startsWith("No ");

function msg(el, text, ok=false){ el.textContent=text||""; el.className = ok ? "message ok" : "message"; }
function usernameToEmail(u){ return `${String(u||"").trim().toLowerCase()}@${LOCAL_EMAIL_DOMAIN}`; }
function escapeHtml(s){return String(s??"").replace(/[&<>"]/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[m]));}

async function init(){
  try { sb = window.supabase.createClient(SUPABASE_PROJECT_URL, SUPABASE_PUBLISHABLE_KEY); }
  catch(e){ msg($("loginMessage"), "Supabase client could not start: "+e.message); return; }
  bindLogin();
  const {data} = await sb.auth.getSession();
  if(data.session) await enterApp(data.session);
}

function bindLogin(){
  $("togglePassword").onclick=()=>{ const p=$("passwordInput"); p.type=p.type==="password"?"text":"password"; };
  $("loginForm").onsubmit=async(e)=>{
    e.preventDefault();
    msg($("loginMessage"), "Checking...", true);
    const username=$("usernameInput").value.trim().toLowerCase();
    const password=$("passwordInput").value;
    if(!/^[a-z]+\.[a-z]+[a-z0-9._-]*$/.test(username)){ msg($("loginMessage"), "Username format should be like paul.a"); return; }
    const {data,error} = await sb.auth.signInWithPassword({email: usernameToEmail(username), password});
    if(error){ msg($("loginMessage"), "Login failed: "+error.message); return; }
    await enterApp(data.session);
  };
  $("logoutBtn").onclick=async()=>{ await sb.auth.signOut(); location.reload(); };
}

async function enterApp(s){
  session=s;
  const {data:p,error} = await sb.from("profiles").select("*").eq("id", session.user.id).single();
  if(error || !p){ msg($("loginMessage"), "Login OK, but no active profile/role found. Create a profile row for this user in Supabase."); await sb.auth.signOut(); return; }
  if(!p.is_active){ msg($("loginMessage"), "This user is passive/inactive. Contact admin."); await sb.auth.signOut(); return; }
  profile=p;
  $("loginPage").classList.add("hidden"); $("appPage").classList.remove("hidden");
  $("currentUser").textContent=profile.username; $("currentRole").textContent=profile.role;
  await loadCoreData();
  setupTabs();
  renderChecker();
}

async function loadCoreData(){
  const [c,d,r,s] = await Promise.all([
    sb.from("countries").select("code,name").eq("active",true).order("name"),
    sb.from("documents").select("id,doc_type,name,description").eq("active",true).order("doc_type").order("name"),
    sb.from("country_rules").select("*").eq("active",true).order("country_name"),
    sb.from("app_settings").select("key,value")
  ]);
  if(c.error) alert("Countries load error: "+c.error.message);
  countries=c.data||[]; documents=d.data||[]; rules=r.data||[];
  const last=(s.data||[]).find(x=>x.key==="last_updated"); $("lastUpdated").textContent=last?.value || "—";
  fillSelect($("regCountry"), countries, "BS"); fillSelect($("natCountry"), countries, "FR"); fillSelect($("ruleCountry"), countries, "FR");
  fillDocs(); renderDocLists();
}
function fillSelect(sel, list, val){ sel.innerHTML=list.map(c=>`<option value="${c.code}" ${c.code===val?'selected':''}>${c.name}</option>`).join(""); }
function fillDocs(){
  const poi=documents.filter(d=>d.doc_type==="poi"), por=documents.filter(d=>d.doc_type==="por");
  $("poiDoc").innerHTML=`<option>No POI provided</option>`+poi.map(d=>`<option>${escapeHtml(d.name)}</option>`).join("");
  $("porDoc").innerHTML=`<option>No POR provided</option>`+por.map(d=>`<option>${escapeHtml(d.name)}</option>`).join("");
}
function renderDocLists(){
  $("poiDocsList").innerHTML=documents.filter(d=>d.doc_type==="poi").map(d=>`<span class="chip" data-tip="${escapeHtml(d.description)}">${escapeHtml(d.name)}</span>`).join("");
  $("porDocsList").innerHTML=documents.filter(d=>d.doc_type==="por").map(d=>`<span class="chip" data-tip="${escapeHtml(d.description)}">${escapeHtml(d.name)}</span>`).join("");
}

function setupTabs(){
  const tabs=["Checker"];
  if(["moderator","admin"].includes(profile.role)) tabs.push("Dashboard","Rules","Bulk Import","Search History","Audit Logs");
  if(profile.role==="admin") tabs.splice(2,0,"Users");
  $("navTabs").innerHTML=tabs.map(t=>`<button data-tab="${t}" class="${t===currentView?'active':''}">${t}</button>`).join("");
  $("navTabs").querySelectorAll("button").forEach(b=>b.onclick=()=>showTab(b.dataset.tab));
}
async function showTab(t){
  currentView=t; setupTabs();
  document.querySelectorAll(".view").forEach(v=>v.classList.remove("active"));
  const map={"Checker":"viewChecker","Dashboard":"viewDashboard","Users":"viewUsers","Rules":"viewRules","Bulk Import":"viewBulk","Search History":"viewSearchHistory","Audit Logs":"viewAudit"};
  $(map[t]).classList.add("active");
  if(t==="Dashboard") loadDashboard(); if(t==="Users") loadUsers(); if(t==="Rules") loadRulesTable(); if(t==="Search History") loadHistory(); if(t==="Audit Logs") loadAudit();
}

function renderChecker(){ $("checkBtn").onclick=runCheck; }
function buildDecision(regCode,natCode,poi,por){
  const reg=countryByCode(regCode), nat=countryByCode(natCode);
  const natRules=rules.filter(r=>r.country_code===natCode && r.applies_to==="nationality");
  const regRules=rules.filter(r=>r.country_code===regCode && r.applies_to==="registration");
  const warnings=regRules.filter(r=>r.rule_type==="platform_block").map(r=>r.note);
  const directNat=natRules.find(r=>r.rule_type==="direct_restricted");
  const directReg=regRules.find(r=>r.rule_type==="direct_restricted");
  let result={decision:"Approved", cls:"success", reason:"No blocking restriction found.", rows:[], warnings};
  if(directNat){ result={decision:"Not Eligible", cls:"danger", reason:`Nationality ${nat.name} is restricted for onboarding.`, rows:[["Nationality",nat.name],["Rule",directNat.note]], warnings}; }
  else if(directReg){ result={decision:"Not Eligible", cls:"danger", reason:`Registration/residence country ${reg.name} is restricted for onboarding.`, rows:[["Registration",reg.name],["Rule",directReg.note]], warnings}; }
  else {
    const both=natRules.find(r=>r.rule_type==="poi_por_required");
    const porOnly=natRules.find(r=>r.rule_type==="por_required");
    if(both){
      if(isProvided(poi)&&isProvided(por)) result={decision:"Eligible with POI + POR", cls:"success", reason:`Client can proceed because POI and POR are provided from ${reg.name}.`, rows:[["Nationality",nat.name],["Requirement","POI + POR required from an unrestricted/workable region"],["Document country",reg.name],["Provided",`${poi} / ${por}`]], warnings};
      else result={decision:"POI + POR Required", cls:"warn", reason:`Client can proceed only if they provide valid POI and POR from ${reg.name}.`, rows:[["Nationality",nat.name],["Requirement","POI and POR required from an unrestricted/workable region"],["Missing",`${isProvided(poi)?'':'POI '}${isProvided(por)?'':'POR'}`.trim()]], warnings};
    } else if(porOnly){
      if(isProvided(por)) result={decision:"Eligible with POR", cls:"success", reason:`Client can proceed because POR is provided from the registration/residence country.`, rows:[["Nationality",nat.name],["Requirement","POR required from an unrestricted/workable region"],["POR country",reg.name],["Provided",por]], warnings};
      else result={decision:"POR Required", cls:"warn", reason:`Client can proceed only if they provide valid POR from ${reg.name}.`, rows:[["Nationality",nat.name],["Requirement","POR is required from an unrestricted/workable region"],["POR country",`POR should be from ${reg.name} if the client is registering/residing there`]], warnings};
    } else {
      result.rows=[["Nationality",nat.name],["Registration",reg.name],["Requirement","No additional POI/POR restriction found in the active database"]];
    }
  }
  return result;
}
async function runCheck(){
  const regCode=$("regCountry").value, natCode=$("natCountry").value, poi=$("poiDoc").value, por=$("porDoc").value;
  const reg=countryByCode(regCode), nat=countryByCode(natCode), res=buildDecision(regCode,natCode,poi,por);
  renderDecision(res);
  await sb.from("search_history").insert({user_id:session.user.id,username:profile.username,role:profile.role,registration_country:reg.name,registration_country_code:reg.code,nationality:nat.name,nationality_code:nat.code,poi_document:poi,por_document:por,decision:res.decision,reason:res.reason,details:{rows:res.rows,warnings:res.warnings}});
}
function renderDecision(res){
  $("decisionBox").className=`decision ${res.cls}`;
  $("decisionBox").innerHTML=`<h3>${escapeHtml(res.decision)}</h3><p>${escapeHtml(res.reason)}</p><div class="detail-box">${res.rows.map(r=>`<div class="detail-row"><b>${escapeHtml(r[0])}</b><span>${escapeHtml(r[1])}</span></div>`).join("")}</div>${res.warnings?.length?`<div class="detail-box"><b>Platform / Notes</b><ul>${res.warnings.map(w=>`<li>${escapeHtml(w)}</li>`).join("")}</ul></div>`:""}`;
}

async function loadDashboard(){
  const [h,a,u]=await Promise.all([sb.from("search_history").select("id,decision,registration_country,nationality,created_at").limit(1000),sb.from("audit_logs").select("id").limit(1000), profile.role==="admin"?callAdmin({action:"list_users"}):Promise.resolve({users:[]})]);
  const today=new Date().toISOString().slice(0,10); const searches=h.data||[];
  const countToday=searches.filter(x=>x.created_at?.slice(0,10)===today).length;
  const common=(field)=>{const m={}; searches.forEach(x=>m[x[field]]=(m[x[field]]||0)+1); return Object.entries(m).sort((a,b)=>b[1]-a[1])[0]?.join(" · ")||"—"};
  $("statsGrid").innerHTML=`<div class="stat"><span>Total searches</span><b>${searches.length}</b></div><div class="stat"><span>Today searches</span><b>${countToday}</b></div><div class="stat"><span>Top registration</span><b>${escapeHtml(common('registration_country'))}</b></div><div class="stat"><span>Top decision</span><b>${escapeHtml(common('decision'))}</b></div><div class="stat"><span>Audit records</span><b>${(a.data||[]).length}</b></div><div class="stat"><span>Users</span><b>${u.users?.length??'—'}</b></div>`;
}

async function callAdmin(payload){
  const token=session.access_token;
  const res=await fetch(`${SUPABASE_PROJECT_URL}/functions/v1/admin-users`,{method:"POST",headers:{"Content-Type":"application/json","Authorization":`Bearer ${token}`},body:JSON.stringify(payload)});
  const data=await res.json().catch(()=>({error:"Invalid function response"}));
  if(!res.ok) throw new Error(data.error||`Function error ${res.status}`);
  return data;
}
async function loadUsers(){
  if(profile.role!=="admin") return;
  try{ const data=await callAdmin({action:"list_users"}); renderUsers(data.users||[]); msg($("usersMessage"),"",true);}catch(e){msg($("usersMessage"),e.message)}
}
function renderUsers(users){
  $("usersTable").innerHTML=`<tr><th>Username</th><th>Display name</th><th>Role</th><th>Active</th><th>Email</th><th>Actions</th></tr>`+users.map(u=>`<tr><td>${escapeHtml(u.username)}</td><td>${escapeHtml(u.display_name||'')}</td><td>${escapeHtml(u.role)}</td><td>${u.is_active?'Active':'Passive'}</td><td>${escapeHtml(u.email)}</td><td><div class="table-actions"><button class="small-btn" onclick="adminPromptReset('${u.id}')">Reset pass</button><button class="small-btn" onclick="adminToggleActive('${u.id}',${!u.is_active})">${u.is_active?'Deactivate':'Activate'}</button><button class="small-btn" onclick="adminChangeRole('${u.id}','${u.role}')">Role</button><button class="small-btn danger-btn" onclick="adminDeleteUser('${u.id}')">Delete</button></div></td></tr>`).join("");
}
$("createUserBtn").onclick=async()=>{try{await callAdmin({action:"create_user",username:$("newUsername").value.trim(),display_name:$("newDisplayName").value.trim(),role:$("newRole").value,password:$("newPassword").value}); msg($("usersMessage"),"User created",true); loadUsers();}catch(e){msg($("usersMessage"),e.message)}};
$("refreshUsers").onclick=loadUsers;
window.adminPromptReset=async(id)=>{const p=prompt("New password"); if(!p)return; try{await callAdmin({action:"reset_password",user_id:id,password:p}); loadUsers();}catch(e){alert(e.message)}};
window.adminToggleActive=async(id,active)=>{try{await callAdmin({action:"set_active",user_id:id,is_active:active}); loadUsers();}catch(e){alert(e.message)}};
window.adminChangeRole=async(id,old)=>{const role=prompt("Role: agent / moderator / admin",old); if(!role)return; try{await callAdmin({action:"change_role",user_id:id,role}); loadUsers();}catch(e){alert(e.message)}};
window.adminDeleteUser=async(id)=>{if(!confirm("Delete user?"))return; try{await callAdmin({action:"delete_user",user_id:id}); loadUsers();}catch(e){alert(e.message)}};

async function loadRulesTable(){
  const {data,error}=await sb.from("country_rules").select("*").order("id",{ascending:false}).limit(250); if(error){msg($("rulesMessage"),error.message);return}
  $("rulesTable").innerHTML=`<tr><th>ID</th><th>Country</th><th>Applies</th><th>Type</th><th>Platforms</th><th>Note</th><th>Actions</th></tr>`+(data||[]).map(r=>`<tr><td>${r.id}</td><td>${escapeHtml(r.country_name)}</td><td>${r.applies_to}</td><td>${r.rule_type}</td><td>${escapeHtml((r.platforms||[]).join('; '))}</td><td>${escapeHtml(r.note)}</td><td><button class="small-btn" onclick="editRuleNote(${r.id})">Edit note</button> <button class="small-btn danger-btn" onclick="deleteRule(${r.id})">Delete</button></td></tr>`).join("");
}
$("refreshRules").onclick=loadRulesTable;
$("addRuleBtn").onclick=async()=>{const c=countryByCode($("ruleCountry").value); const platforms=$("rulePlatforms").value.split(';').map(x=>x.trim()).filter(Boolean); const type=$("ruleType").value; const payload={country_code:c.code,country_name:c.name,applies_to:$("ruleApplies").value,rule_type:type,platforms,requires_poi:type==='poi_por_required',requires_por:type==='poi_por_required'||type==='por_required',note:$("ruleNote").value,active:true}; const {error}=await sb.from("country_rules").insert(payload); if(error)msg($("rulesMessage"),error.message); else{msg($("rulesMessage"),"Rule added",true); await loadCoreData(); loadRulesTable();}};
window.editRuleNote=async(id)=>{const note=prompt("New note"); if(note===null)return; const {error}=await sb.from("country_rules").update({note}).eq("id",id); if(error)alert(error.message); else{await loadCoreData(); loadRulesTable();}};
window.deleteRule=async(id)=>{if(!confirm("Delete rule?"))return; const {error}=await sb.from("country_rules").delete().eq("id",id); if(error)alert(error.message); else{await loadCoreData(); loadRulesTable();}};

$("importCsvBtn").onclick=async()=>{try{const rows=parseCsv($("csvInput").value); if(!rows.length)throw new Error("No rows"); const {error}=await sb.from("country_rules").insert(rows); if(error)throw error; msg($("bulkMessage"),`${rows.length} rows imported`,true); await loadCoreData();}catch(e){msg($("bulkMessage"),e.message)}};
function parseCsv(text){return text.split(/\r?\n/).map(l=>l.trim()).filter(Boolean).map(line=>{const p=line.split(',').map(x=>x.trim()); return {country_code:p[0],country_name:p[1],applies_to:p[2],rule_type:p[3],platforms:(p[4]||'').split(';').filter(Boolean),note:p[5]||'',requires_poi:p[6]==='true',requires_por:p[7]==='true',active:p[8]!=='false'};});}

async function loadHistory(){ const {data,error}=await sb.from("search_history").select("*").order("created_at",{ascending:false}).limit(300); if(error){$("historyTable").innerHTML=`<tr><td>${escapeHtml(error.message)}</td></tr>`;return} $("historyTable").innerHTML=`<tr><th>Date</th><th>User</th><th>Reg.</th><th>Nationality</th><th>POI</th><th>POR</th><th>Decision</th></tr>`+(data||[]).map(h=>`<tr><td>${new Date(h.created_at).toLocaleString()}</td><td>${escapeHtml(h.username)}</td><td>${escapeHtml(h.registration_country)}</td><td>${escapeHtml(h.nationality)}</td><td>${escapeHtml(h.poi_document)}</td><td>${escapeHtml(h.por_document)}</td><td>${escapeHtml(h.decision)}</td></tr>`).join(""); }
$("refreshHistory").onclick=loadHistory;
async function loadAudit(){ const {data,error}=await sb.from("audit_logs").select("*").order("created_at",{ascending:false}).limit(300); if(error){$("auditTable").innerHTML=`<tr><td>${escapeHtml(error.message)}</td></tr>`;return} $("auditTable").innerHTML=`<tr><th>Date</th><th>Actor</th><th>Role</th><th>Action</th><th>Target</th><th>Name</th></tr>`+(data||[]).map(a=>`<tr><td>${new Date(a.created_at).toLocaleString()}</td><td>${escapeHtml(a.actor_username)}</td><td>${escapeHtml(a.actor_role)}</td><td>${escapeHtml(a.action_type)}</td><td>${escapeHtml(a.target_table||'')}</td><td>${escapeHtml(a.target_name||'')}</td></tr>`).join(""); }
$("refreshAudit").onclick=loadAudit;

init();
