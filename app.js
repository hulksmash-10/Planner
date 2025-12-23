// Planner Flat v3 (ALL MODULES) - Phone upload friendly
// Data: IndexedDB stores: tasks, recurring, habits, habitLogs, big, notes
// Week starts Monday.

const DB_NAME = "planner_v3";
const DB_VERSION = 3;

const STORES = {
  tasks: "tasks",
  recurring: "recurring",
  habits: "habits",
  habitLogs: "habitLogs",
  big: "big",
  notes: "notes",
};

const IDX_TASKS_BY_DATE_MODE = "by_date_mode";
const IDX_BIG_BY_MODE = "by_mode";
const IDX_HABITS_BY_MODE = "by_mode";
const IDX_RECUR_BY_MODE = "by_mode";
const IDX_NOTES_BY_DATE_MODE = "by_date_mode";

// DEBUG: show JS errors as toast so you can report the exact message
window.addEventListener("error", (e) => {
  try{ toast("JS Error: " + (e.message || "unknown")); }catch(_){}
});
window.addEventListener("unhandledrejection", (e) => {
  try{ toast("Promise Error: " + (e.reason?.message || String(e.reason || "unknown"))); }catch(_){}
});

const state = {
  currentTab: "plan",
  currentMode: "Personal",
  currentDate: "",
};

// ---------- Utilities ----------
function todayISO(){
  const d=new Date(); const tz=d.getTimezoneOffset()*60000;
  return new Date(d.getTime()-tz).toISOString().slice(0,10);
}
function isoFromDate(d){
  const tz=d.getTimezoneOffset()*60000;
  return new Date(d.getTime()-tz).toISOString().slice(0,10);
}
function addDaysISO(dateISO,n){
  const d=new Date(dateISO+"T00:00:00"); d.setDate(d.getDate()+n);
  return isoFromDate(d);
}
function uid(){
  return (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())+"-"+Math.random().toString(16).slice(2));
}
function escapeHtml(str){
  return String(str ?? "")
    .replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")
    .replaceAll('"',"&quot;").replaceAll("'","&#039;");
}
function minutesFromHHMM(hhmm){
  if(!hhmm) return null;
  const [h,m]=hhmm.split(":").map(x=>parseInt(x,10));
  if(Number.isNaN(h)||Number.isNaN(m)) return null;
  return h*60+m;
}
function dayOfWeekMon0(dateISO){
  const d = new Date(dateISO+"T00:00:00");
  const js = d.getDay(); // Sun=0..Sat=6
  return (js + 6) % 7;   // Mon=0..Sun=6
}
function fmtDateHuman(dateISO){
  const d = new Date(dateISO+"T00:00:00");
  const dd = String(d.getDate()).padStart(2,"0");
  const mm = String(d.getMonth()+1).padStart(2,"0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}
function weekStartMonday(dateISO){
  const d = new Date(dateISO+"T00:00:00");
  const dow = dayOfWeekMon0(dateISO);
  d.setDate(d.getDate() - dow);
  return isoFromDate(d);
}
function rangeDays(startISO, n){
  const out = [];
  for(let i=0;i<n;i++) out.push(addDaysISO(startISO, i));
  return out;
}
function priRank(p){ return (p==="P1"?1 : p==="P2"?2 : 3); }

function updateNetChip(){
  const dot=document.getElementById("netDot"), txt=document.getElementById("netText");
  if(!dot||!txt) return;
  const online=navigator.onLine;
  dot.classList.toggle("off", !online);
  txt.textContent = online ? "Offline-ready" : "Offline mode";
}
function toast(msg){
  const el=document.getElementById("toast"); if(!el) return;
  el.textContent=msg; el.style.display="block";
  clearTimeout(toast._t); toast._t=setTimeout(()=>el.style.display="none", 1600);
}

// ---------- IndexedDB ----------
let _db=null;
function openDB(){
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded=()=>{
      const db=req.result;

      if(!db.objectStoreNames.contains(STORES.tasks)){
        const s=db.createObjectStore(STORES.tasks,{keyPath:"id"});
        s.createIndex(IDX_TASKS_BY_DATE_MODE, ["date","mode"]);
      }

      if(!db.objectStoreNames.contains(STORES.recurring)){
        const s=db.createObjectStore(STORES.recurring,{keyPath:"id"});
        s.createIndex(IDX_RECUR_BY_MODE, ["mode"]);
      }

      if(!db.objectStoreNames.contains(STORES.habits)){
        const s=db.createObjectStore(STORES.habits,{keyPath:"id"});
        s.createIndex(IDX_HABITS_BY_MODE, ["mode"]);
      }

      if(!db.objectStoreNames.contains(STORES.habitLogs)){
        db.createObjectStore(STORES.habitLogs,{keyPath:"key"}); // `${date}|${mode}|${habitId}`
      }

      if(!db.objectStoreNames.contains(STORES.big)){
        const s=db.createObjectStore(STORES.big,{keyPath:"id"});
        s.createIndex(IDX_BIG_BY_MODE, ["mode"]);
      }

      if(!db.objectStoreNames.contains(STORES.notes)){
        const s=db.createObjectStore(STORES.notes,{keyPath:"key"}); // `${date}|${mode}`
        s.createIndex(IDX_NOTES_BY_DATE_MODE, ["date","mode"]);
      }
    };
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error);
  });
}
function reqToPromise(req){
  return new Promise((resolve,reject)=>{ req.onsuccess=()=>resolve(req.result); req.onerror=()=>reject(req.error); });
}
function tx(storeNames, mode="readonly"){
  const t=_db.transaction(storeNames, mode);
  const stores = Object.fromEntries(storeNames.map(n=>[n, t.objectStore(n)]));
  return { t, stores };
}
function txDone(t){
  return new Promise((resolve,reject)=>{ t.oncomplete=()=>resolve(true); t.onerror=()=>reject(t.error); t.onabort=()=>reject(t.error); });
}

// --- tasks
async function listTasks(date, mode){
  const { t, stores } = tx([STORES.tasks], "readonly");
  const idx = stores[STORES.tasks].index(IDX_TASKS_BY_DATE_MODE);
  const res = await reqToPromise(idx.getAll([date, mode]));
  await txDone(t);
  return Array.isArray(res) ? res : [];
}
async function upsertTask(task){
  const { t, stores } = tx([STORES.tasks], "readwrite");
  await reqToPromise(stores[STORES.tasks].put(task));
  await txDone(t);
}
async function deleteTask(id){
  const { t, stores } = tx([STORES.tasks], "readwrite");
  await reqToPromise(stores[STORES.tasks].delete(id));
  await txDone(t);
}

// --- recurring
async function listRecurring(mode){
  const { t, stores } = tx([STORES.recurring], "readonly");
  const idx = stores[STORES.recurring].index(IDX_RECUR_BY_MODE);
  const res = await reqToPromise(idx.getAll([mode]));
  await txDone(t);
  return Array.isArray(res) ? res : [];
}
async function upsertRecurring(rule){
  const { t, stores } = tx([STORES.recurring], "readwrite");
  await reqToPromise(stores[STORES.recurring].put(rule));
  await txDone(t);
}
async function deleteRecurring(id){
  const { t, stores } = tx([STORES.recurring], "readwrite");
  await reqToPromise(stores[STORES.recurring].delete(id));
  await txDone(t);
}

// --- habits + logs
async function listHabits(mode){
  const { t, stores } = tx([STORES.habits], "readonly");
  const idx = stores[STORES.habits].index(IDX_HABITS_BY_MODE);
  const res = await reqToPromise(idx.getAll([mode]));
  await txDone(t);
  return Array.isArray(res) ? res : [];
}
async function upsertHabit(habit){
  const { t, stores } = tx([STORES.habits], "readwrite");
  await reqToPromise(stores[STORES.habits].put(habit));
  await txDone(t);
}
async function deleteHabit(id){
  const { t, stores } = tx([STORES.habits], "readwrite");
  await reqToPromise(stores[STORES.habits].delete(id));
  await txDone(t);
}
function habitLogKey(date, mode, habitId){ return `${date}|${mode}|${habitId}`; }
async function getHabitLog(date, mode, habitId){
  const { t, stores } = tx([STORES.habitLogs], "readonly");
  const res = await reqToPromise(stores[STORES.habitLogs].get(habitLogKey(date,mode,habitId)));
  await txDone(t);
  return res || null;
}
async function upsertHabitLog(log){
  const { t, stores } = tx([STORES.habitLogs], "readwrite");
  await reqToPromise(stores[STORES.habitLogs].put(log));
  await txDone(t);
}

// --- big tasks
async function listBig(mode){
  const { t, stores } = tx([STORES.big], "readonly");
  const idx = stores[STORES.big].index(IDX_BIG_BY_MODE);
  const res = await reqToPromise(idx.getAll([mode]));
  await txDone(t);
  return Array.isArray(res) ? res : [];
}
async function upsertBig(item){
  const { t, stores } = tx([STORES.big], "readwrite");
  await reqToPromise(stores[STORES.big].put(item));
  await txDone(t);
}
async function deleteBig(id){
  const { t, stores } = tx([STORES.big], "readwrite");
  await reqToPromise(stores[STORES.big].delete(id));
  await txDone(t);
}

// --- notes
function notesKey(date, mode){ return `${date}|${mode}`; }
async function getNotes(date, mode){
  const { t, stores } = tx([STORES.notes], "readonly");
  const res = await reqToPromise(stores[STORES.notes].get(notesKey(date,mode)));
  await txDone(t);
  return res?.text || "";
}
async function setNotes(date, mode, text){
  const { t, stores } = tx([STORES.notes], "readwrite");
  await reqToPromise(stores[STORES.notes].put({ key: notesKey(date,mode), date, mode, text, updatedAt: new Date().toISOString() }));
  await txDone(t);
}

// ---------- Validation ----------
function validatePlannedTimes(plannedStart, plannedFinish){
  if(plannedFinish && !plannedStart) return { ok:false, error:"Target finish requires start time." };
  if(plannedStart && plannedFinish){
    const s=minutesFromHHMM(plannedStart), f=minutesFromHHMM(plannedFinish);
    if(s===null||f===null) return { ok:false, error:"Invalid planned time." };
    if(f<=s) return { ok:false, error:"Target finish must be after start time." };
  }
  return { ok:true };
}
function validateActualTimes(actualStart, actualFinish){
  if(actualFinish && !actualStart) return { ok:false, error:"Actual finish requires actual start." };
  if(actualStart && actualFinish){
    const s=minutesFromHHMM(actualStart), f=minutesFromHHMM(actualFinish);
    if(s===null||f===null) return { ok:false, error:"Invalid actual time." };
    if(f<=s) return { ok:false, error:"Actual finish must be after actual start." };
  }
  return { ok:true };
}

// ---------- Auto-materialize recurring + habit-timed tasks ----------
async function ensureRecurringTasks(date, mode){
  const rules = await listRecurring(mode);
  if(!rules.length) return;

  const existing = await listTasks(date, mode);
  const existingByRule = new Set(existing.filter(t=>t.sourceRuleId).map(t=>t.sourceRuleId));

  const dow = dayOfWeekMon0(date);
  const now = new Date().toISOString();

  for(const r of rules){
    if(!r.active) continue;
    if(Array.isArray(r.days) && r.days.length>0 && !r.days.includes(dow)) continue;
    if(existingByRule.has(r.id)) continue;

    const t = {
      id: uid(),
      date,
      mode,
      title: r.title,
      plannedStart: r.plannedStart || "",
      plannedFinish: r.plannedFinish || "",
      priority: r.priority || "P2",
      done: false,
      actualStart: "",
      actualFinish: "",
      createdAt: now,
      updatedAt: now,
      sourceRuleId: r.id,
      sourceHabitId: "",
    };
    await upsertTask(t);
  }
}

async function ensureHabitTimedTasks(date, mode){
  const habits = await listHabits(mode);
  if(!habits.length) return;

  const existing = await listTasks(date, mode);
  const existingByHabit = new Set(existing.filter(t=>t.sourceHabitId).map(t=>t.sourceHabitId));

  const dow = dayOfWeekMon0(date);
  const now = new Date().toISOString();

  for(const h of habits){
    if(!h.active) continue;
    const applies = (!Array.isArray(h.days) || h.days.length===0) ? true : h.days.includes(dow);
    if(!applies) continue;
    if(!h.timeStart) continue;
    if(existingByHabit.has(h.id)) continue;

    const t = {
      id: uid(),
      date,
      mode,
      title: `Habit: ${h.title}`,
      plannedStart: h.timeStart || "",
      plannedFinish: h.timeFinish || "",
      priority: h.priority || "P3",
      done: false,
      actualStart: "",
      actualFinish: "",
      createdAt: now,
      updatedAt: now,
      sourceRuleId: "",
      sourceHabitId: h.id,
    };
    await upsertTask(t);
  }
}

// ---------- Sorting & overlaps ----------
function sortTasksChronologically(tasks){
  const timed=[], untimed=[];
  for(const t of tasks){ (t.plannedStart ? timed : untimed).push(t); }
  timed.sort((a,b)=>{
    const as=minutesFromHHMM(a.plannedStart)??999999, bs=minutesFromHHMM(b.plannedStart)??999999;
    if(as!==bs) return as-bs;
    const af=minutesFromHHMM(a.plannedFinish)??999999, bf=minutesFromHHMM(b.plannedFinish)??999999;
    if(af!==bf) return af-bf;
    const pr = priRank(a.priority||"P2") - priRank(b.priority||"P2");
    if(pr!==0) return pr;
    return (a.createdAt||"").localeCompare(b.createdAt||"");
  });
  untimed.sort((a,b)=>(a.createdAt||"").localeCompare(b.createdAt||""));
  return [...timed, ...untimed];
}
function detectOverlaps(sorted){
  const overlaps=new Map();
  const ranges=sorted
    .filter(t=>t.plannedStart&&t.plannedFinish)
    .map(t=>({...t,s:minutesFromHHMM(t.plannedStart),f:minutesFromHHMM(t.plannedFinish)}))
    .filter(t=>t.s!==null&&t.f!==null)
    .sort((a,b)=>a.s-b.s);

  for(let i=0;i<ranges.length;i++){
    for(let j=i+1;j<ranges.length;j++){
      const a=ranges[i], b=ranges[j];
      if(b.s>=a.f) break;
      if(b.s<a.f){
        if(!overlaps.has(a.id)) overlaps.set(a.id,[]);
        if(!overlaps.has(b.id)) overlaps.set(b.id,[]);
        overlaps.get(a.id).push(b.id);
        overlaps.get(b.id).push(a.id);
      }
    }
  }
  return overlaps;
}

// ---------- Navigation ----------
function applyModeButtons(){
  document.getElementById("modePro").classList.toggle("active", state.currentMode==="Professional");
  document.getElementById("modePer").classList.toggle("active", state.currentMode==="Personal");
}
function setMode(mode){
  state.currentMode = mode;
  applyModeButtons();
  refreshAll();
}
function setDate(dateISO){
  state.currentDate = dateISO;
  document.getElementById("date").value = dateISO;
  refreshAll();
}
function setTab(tab){
  state.currentTab = tab;

  const panels = {
    plan: document.getElementById("panel-plan"),
    habits: document.getElementById("panel-habits"),
    big: document.getElementById("panel-big"),
    notes: document.getElementById("panel-notes"),
    review: document.getElementById("panel-review"),
    backup: document.getElementById("panel-backup"),
  };
  Object.entries(panels).forEach(([k, el]) => el.style.display = (k===tab) ? "" : "none");

  for(const b of document.querySelectorAll(".navBtn")) b.classList.toggle("active", b.dataset.tab===tab);

  const fab = document.getElementById("fab");
  fab.style.display = (tab==="plan" || tab==="habits" || tab==="big") ? "" : "none";
}

// Safety: event delegation for FAB and nav (mobile browsers can be weird)
document.addEventListener("click", (e) => {
  const fab = e.target.closest && e.target.closest("#fab");
  if(fab){ onFab(); return; }
  const navBtn = e.target.closest && e.target.closest(".navBtn");
  if(navBtn){ setTab(navBtn.dataset.tab); return; }
});

async function refreshAll(){
  await ensureRecurringTasks(state.currentDate, state.currentMode);
  await ensureHabitTimedTasks(state.currentDate, state.currentMode);

  await Promise.all([
    refreshTasks(),
    refreshHabits(),
    refreshBig(),
    refreshNotes(),
    refreshReview(),
  ]);
}

// ---------- PLAN ----------
function renderTaskKpis(tasks){
  const done=tasks.filter(t=>t.done).length, total=tasks.length;
  const pct = total ? Math.round((done/total)*100) : 0;
  document.getElementById("taskBadge").textContent = `${done}/${total} done`;
  document.getElementById("taskPct").textContent = `${pct}%`;
  document.getElementById("taskBar").style.width = `${pct}%`;
}
function renderTaskWarnings(overlaps){
  const el=document.getElementById("taskWarnings");
  const n=[...overlaps.keys()].length;
  if(n===0){ el.style.display="none"; el.textContent=""; return; }
  el.style.display=""; el.textContent=`Warning: ${n} task(s) overlap in time.`;
}
function taskBadgePill(t){
  const timePill = t.plannedStart ? `<span class="pill">${escapeHtml(t.plannedStart)}${t.plannedFinish ? " → "+escapeHtml(t.plannedFinish) : ""}</span>` : "";
  const actualPill = t.actualStart ? `<span class="pill">Actual ${escapeHtml(t.actualStart)}${t.actualFinish ? " → "+escapeHtml(t.actualFinish) : ""}</span>` : "";
  const srcPill = t.sourceHabitId ? `<span class="pill" style="border-color: rgba(34,197,94,.35); color: rgba(34,197,94,.95); background: rgba(34,197,94,.06);">Habit</span>` :
                  t.sourceRuleId ? `<span class="pill" style="border-color: rgba(79,140,255,.30); color: rgba(79,140,255,.95); background: rgba(79,140,255,.06);">Recurring</span>` : "";
  return `${timePill}<span class="pill pri ${(t.priority||"P2").toLowerCase()}">${escapeHtml(t.priority||"P2")}</span>${actualPill}${srcPill}`;
}

async function refreshTasks(){
  const tasks = await listTasks(state.currentDate, state.currentMode);
  const sorted = sortTasksChronologically(tasks);
  const overlaps = detectOverlaps(sorted);
  renderTaskKpis(sorted);
  renderTaskWarnings(overlaps);

  const list = document.getElementById("taskList");
  list.innerHTML = "";
  if(!sorted.length){
    list.innerHTML = `<div class="empty">No tasks yet. Tap + to add your first task.</div>`;
    return;
  }

  for(const t of sorted){
    const isWarn = overlaps.has(t.id);
    const div = document.createElement("div");
    div.className = "item" + (t.done ? " done" : "") + (isWarn ? " warn" : "");
    div.innerHTML = `
      <div class="check" role="button" aria-label="Toggle done">
        <svg viewBox="0 0 24 24"><path d="M9.2 16.6 4.9 12.3a1 1 0 0 1 1.4-1.4l2.9 2.9 8.4-8.4a1 1 0 1 1 1.4 1.4l-9.8 9.8a1 1 0 0 1-1.4 0Z"/></svg>
      </div>
      <div class="mid">
        <p class="taskText" title="${escapeHtml(t.title)}">${escapeHtml(t.title)}</p>
        <div class="meta">
          ${taskBadgePill(t)}
          ${isWarn ? `<span class="pill" style="border-color: rgba(245,158,11,.55); color: rgba(245,158,11,.95); background: rgba(245,158,11,.06);">Overlaps</span>` : ""}
        </div>
      </div>
      <button class="menuBtn" type="button" aria-label="Edit">Edit</button>
    `;
    div.querySelector(".check").addEventListener("click", async ()=>{
      const updated = { ...t, done: !t.done, updatedAt: new Date().toISOString() };
      await upsertTask(updated);

      if(t.sourceHabitId){
        const log = await getHabitLog(state.currentDate, state.currentMode, t.sourceHabitId);
        const next = log || { key: habitLogKey(state.currentDate,state.currentMode,t.sourceHabitId), date: state.currentDate, mode: state.currentMode, habitId: t.sourceHabitId };
        next.done = updated.done;
        next.actualStart = updated.actualStart || next.actualStart || "";
        next.actualFinish = updated.actualFinish || next.actualFinish || "";
        next.updatedAt = new Date().toISOString();
        await upsertHabitLog(next);
      }

      await refreshAll();
    });
    div.querySelector(".menuBtn").addEventListener("click", ()=> openModalTask("edit", t));
    list.appendChild(div);
  }
}

async function copyTasks(fromDate,toDate,mode,{onlyUndone=false}={}){
  const tasks=await listTasks(fromDate,mode);
  const filtered=onlyUndone?tasks.filter(x=>!x.done):tasks;
  const now=new Date().toISOString();
  for(const t of filtered){
    const copy={
      ...t,
      id: uid(),
      date: toDate,
      done:false,
      actualStart:"",
      actualFinish:"",
      createdAt: now,
      updatedAt: now,
      sourceRuleId: "",
      sourceHabitId: "",
    };
    await upsertTask(copy);
  }
  return filtered.length;
}

// ---------- HABITS ----------
function habitAppliesToday(habit){
  if(!habit.active) return false;
  const dow = dayOfWeekMon0(state.currentDate);
  if(!Array.isArray(habit.days) || habit.days.length===0) return true;
  return habit.days.includes(dow);
}

async function refreshHabits(){
  const habits = await listHabits(state.currentMode);
  habits.sort((a,b)=>{
    if(!!a.active !== !!b.active) return a.active ? -1 : 1;
    return (a.title||"").localeCompare(b.title||"");
  });

  const list = document.getElementById("habitList");
  list.innerHTML = "";

  const applicable = habits.filter(h=>habitAppliesToday(h));
  let doneCount = 0;

  for(const h of applicable){
    const log = await getHabitLog(state.currentDate, state.currentMode, h.id);
    const done = !!log?.done;
    if(done) doneCount++;

    const div = document.createElement("div");
    div.className = "item" + (done ? " done" : "");
    const timePill = h.timeStart ? `<span class="pill">${escapeHtml(h.timeStart)}${h.timeFinish ? " → "+escapeHtml(h.timeFinish) : ""}</span>` : "";
    const freqPill = `<span class="pill">${escapeHtml(String(h.freqPerWeek||0))}/week</span>`;
    const streamPill = `<span class="pill">${escapeHtml(h.stream||"Stream")}</span>`;
    const notePill = (log?.note) ? `<span class="pill">Note</span>` : "";
    div.innerHTML = `
      <div class="check" role="button" aria-label="Toggle done">
        <svg viewBox="0 0 24 24"><path d="M9.2 16.6 4.9 12.3a1 1 0 0 1 1.4-1.4l2.9 2.9 8.4-8.4a1 1 0 1 1 1.4 1.4l-9.8 9.8a1 1 0 0 1-1.4 0Z"/></svg>
      </div>
      <div class="mid">
        <p class="taskText" title="${escapeHtml(h.title)}">${escapeHtml(h.title)}</p>
        <div class="meta">
          ${timePill}${freqPill}${streamPill}${notePill}
          ${h.reminderTime ? `<span class="pill" style="border-color: rgba(79,140,255,.30); color: rgba(79,140,255,.95); background: rgba(79,140,255,.06);">Reminder</span>` : ""}
          ${log?.actualStart ? `<span class="pill">Actual ${escapeHtml(log.actualStart)}${log.actualFinish ? " → "+escapeHtml(log.actualFinish) : ""}</span>` : ""}
        </div>
      </div>
      <button class="menuBtn" type="button" aria-label="Edit habit">Edit</button>
    `;

    div.querySelector(".check").addEventListener("click", async ()=>{
      const now = new Date().toISOString();
      const next = log || { key: habitLogKey(state.currentDate,state.currentMode,h.id), date: state.currentDate, mode: state.currentMode, habitId: h.id, actualStart:"", actualFinish:"", note:"" };
      next.done = !done;
      next.updatedAt = now;
      await upsertHabitLog(next);

      if(h.timeStart){
        const tasks = await listTasks(state.currentDate, state.currentMode);
        const linked = tasks.find(t=>t.sourceHabitId===h.id);
        if(linked){
          await upsertTask({ ...linked, done: next.done, updatedAt: now, actualStart: next.actualStart || linked.actualStart, actualFinish: next.actualFinish || linked.actualFinish });
        }
      }

      await refreshAll();
    });

    div.querySelector(".menuBtn").addEventListener("click", ()=> openModalHabit("edit", h));
    // Tap row (excluding check/edit) opens today's record
    div.addEventListener("click", (e)=>{
      if(e.target.closest(".check") || e.target.closest(".menuBtn")) return;
      openModalHabitLog(h);
    });

    list.appendChild(div);
  }

  if(!applicable.length){
    list.innerHTML = `<div class="empty">No habits for today. Tap + to add a habit.</div>`;
  }

  document.getElementById("habitsBadge").textContent = `${doneCount}/${applicable.length} done`;
}

// ---------- BIG TASKS ----------
function bigSort(items){
  return items.slice().sort((a,b)=>{
    if(!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
    const ad=a.dueDate||"9999-12-31", bd=b.dueDate||"9999-12-31";
    if(ad!==bd) return ad.localeCompare(bd);
    const pr=priRank(a.priority||"P2") - priRank(b.priority||"P2");
    if(pr!==0) return pr;
    return (a.createdAt||"").localeCompare(b.createdAt||"");
  });
}

async function refreshBig(){
  const items = await listBig(state.currentMode);
  const openItems = items.filter(x=>!x.done);
  const list = document.getElementById("bigList");
  list.innerHTML = "";

  const sorted = bigSort(items);

  if(!sorted.length){
    list.innerHTML = `<div class="empty">No big tasks yet. Tap + to add a big task.</div>`;
    document.getElementById("bigBadge").textContent = `0 open`;
    return;
  }

  for(const it of sorted){
    const div = document.createElement("div");
    div.className = "item" + (it.done ? " done" : "");
    const due = it.dueDate ? `<span class="pill">Due ${escapeHtml(fmtDateHuman(it.dueDate))}</span>` : "";
    const pin = it.pinned ? `<span class="pill" style="border-color: rgba(79,140,255,.30); color: rgba(79,140,255,.95); background: rgba(79,140,255,.06);">Pinned</span>` : "";
    div.innerHTML = `
      <div class="check" role="button" aria-label="Toggle done">
        <svg viewBox="0 0 24 24"><path d="M9.2 16.6 4.9 12.3a1 1 0 0 1 1.4-1.4l2.9 2.9 8.4-8.4a1 1 0 1 1 1.4 1.4l-9.8 9.8a1 1 0 0 1-1.4 0Z"/></svg>
      </div>
      <div class="mid">
        <p class="taskText" title="${escapeHtml(it.title)}">${escapeHtml(it.title)}</p>
        <div class="meta">
          ${pin}${due}
          <span class="pill pri ${(it.priority||"P2").toLowerCase()}">${escapeHtml(it.priority||"P2")}</span>
        </div>
      </div>
      <button class="menuBtn" type="button" aria-label="Edit big task">Edit</button>
    `;

    div.querySelector(".check").addEventListener("click", async ()=>{
      const now = new Date().toISOString();
      await upsertBig({ ...it, done: !it.done, updatedAt: now });
      toast(it.done ? "Marked open" : "Completed");
      await refreshBig();
      await refreshReview();
    });

    div.querySelector(".menuBtn").addEventListener("click", ()=> openModalBig("edit", it));
    list.appendChild(div);
  }

  document.getElementById("bigBadge").textContent = `${openItems.length} open`;
}

// ---------- NOTES ----------
let _notesDebounce = null;

// ---------- FAB ----------
function onFab(){
  if(state.currentTab==="plan") openModalTask("create");
  else if(state.currentTab==="habits") openModalHabit("create");
  else if(state.currentTab==="big") openModalBig("create");
}

// ---------- Init ----------
(async function init(){
  _db = await openDB();

  state.currentDate = todayISO();
  state.currentMode = "Personal";

  updateNetChip();
  window.addEventListener("online", updateNetChip);
  window.addEventListener("offline", updateNetChip);

  for(const b of document.querySelectorAll(".navBtn")){
    b.addEventListener("click", ()=> setTab(b.dataset.tab));
  }
  setTab("plan");

  applyModeButtons();
  const dateEl=document.getElementById("date");
  dateEl.value=state.currentDate;
  dateEl.addEventListener("change", ()=> setDate(dateEl.value));
  document.getElementById("prevDay").addEventListener("click", ()=> setDate(addDaysISO(state.currentDate, -1)));
  document.getElementById("nextDay").addEventListener("click", ()=> setDate(addDaysISO(state.currentDate, 1)));
  document.getElementById("todayBtn").addEventListener("click", ()=> setDate(todayISO()));
  document.getElementById("modePro").addEventListener("click", ()=> setMode("Professional"));
  document.getElementById("modePer").addEventListener("click", ()=> setMode("Personal"));

  document.getElementById("copyYesterdayBtn").addEventListener("click", async ()=>{
    const from=addDaysISO(state.currentDate,-1);
    const choice=prompt("Copy: type A for all, U for only undone, anything else to cancel","U");
    if(!choice) return;
    const c=choice.trim().toUpperCase();
    if(c!=="A" && c!=="U") return;
    const n=await copyTasks(from, state.currentDate, state.currentMode, { onlyUndone: c==="U" });
    toast(`Copied ${n} task(s)`);
    await refreshAll();
  });
  document.getElementById("recurringBtn").addEventListener("click", openModalRecurringManager);

  const notesBox = document.getElementById("notesBox");
  notesBox.addEventListener("input", ()=>{
    clearTimeout(_notesDebounce);
    _notesDebounce = setTimeout(async ()=>{
      await setNotes(state.currentDate, state.currentMode, notesBox.value || "");
      document.getElementById("notesSaved").textContent = "Saved";
      setTimeout(()=>document.getElementById("notesSaved").textContent="Auto-save", 1200);
    }, 450);
  });

  document.getElementById("exportBtn").addEventListener("click", exportBackup);
  document.getElementById("importBtn").addEventListener("click", ()=> document.getElementById("importFile").click());
  document.getElementById("importFile").addEventListener("change", async (e)=>{
    const f = e.target.files && e.target.files[0];
    if(!f) return;
    if(!confirm("Import will overwrite your current data. Continue?")) return;
    await importBackupFile(f);
    e.target.value = "";
  });
  document.getElementById("clearDataBtn").addEventListener("click", clearAllData);

  document.getElementById("closeModal").addEventListener("click", closeModal);
  document.getElementById("modalBg").addEventListener("click", (e)=>{ if(e.target.id==="modalBg") closeModal(); });

  document.getElementById("fab").addEventListener("click", onFab);

  // Header Add buttons (fallback if FAB is blocked by overlays)
  const addTaskBtn = document.getElementById("addTaskBtn");
  if(addTaskBtn) addTaskBtn.addEventListener("click", ()=> openModalTask("create"));
  const addHabitBtn = document.getElementById("addHabitBtn");
  if(addHabitBtn) addHabitBtn.addEventListener("click", ()=> openModalHabit("create"));
  const addBigBtn = document.getElementById("addBigBtn");
  if(addBigBtn) addBigBtn.addEventListener("click", ()=> openModalBig("create"));

  // Extra: touchstart for FAB (some mobile layers swallow click)
  const fabEl = document.getElementById("fab");
  if(fabEl){
    fabEl.addEventListener("touchstart", (e)=>{ e.preventDefault(); onFab(); }, { passive: false });
  }

  await refreshAll();
  // Service worker temporarily disabled in DEBUG build to avoid stale cache issues.
})();




