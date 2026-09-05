(function(){
  const PALETTE = ['#F0C64C','#E37A56','#6FA6B4','#B7B08A','#D89A8A','#8FB6A6','#E0B84C','#7C9EB2'];
  const CONFETTI_COLORS = ['#F0C64C','#E37A56','#6FA6B4','#8FB6A6','#D89A8A'];
  const STORAGE_PREFIX = 'homeroom:';
  let classes = [];          // [{id, name}]
  let currentClassId = null;
  let roster = [];           // current class's student names
  let points = {};           // name -> number

  // plinko picker state
  let raceNames = [];
  let pickerPool = [];       // remaining names for no-repeat mode
  let racing = false;

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  async function storeGet(key, fallback){
    try{
      const r = await window.storage.get(key, false);
      return r ? JSON.parse(r.value) : fallback;
    }catch(e){ return fallback; }
  }
  async function storeSet(key, value){
    try{ await window.storage.set(key, JSON.stringify(value), false); }catch(e){ /* ignore */ }
  }
  async function storeDelete(key){
    try{ await window.storage.delete(key, false); }catch(e){ /* ignore */ }
  }

  function uid(){ return 'c' + Math.random().toString(36).slice(2,9); }

  // ---------------- INIT ----------------
  async function init(){
    classes = await storeGet(STORAGE_PREFIX + 'classes', []);
    if(classes.length === 0){
      const id = uid();
      classes = [{id, name:'My class'}];
      await storeSet(STORAGE_PREFIX + 'classes', classes);
      await storeSet(STORAGE_PREFIX + 'roster:' + id, ['Amara','Diego','Priya','Wes','Jonah','Leila']);
    }
    const lastId = await storeGet(STORAGE_PREFIX + 'lastClass', null);
    currentClassId = (lastId && classes.find(c=>c.id===lastId)) ? lastId : classes[0].id;
    generatePegs();
    await loadClass(currentClassId);
    renderClassPicker();
    bindNav();
    bindRoster();
    bindPicker();
    bindGroups();
    bindSeating();
    bindTimer();
    bindNoise();
    bindPoints();
    showPanel('roster');
  }

  async function loadClass(id){
    currentClassId = id;
    roster = await storeGet(STORAGE_PREFIX + 'roster:' + id, []);
    points = await storeGet(STORAGE_PREFIX + 'points:' + id, {});
    pickerPool = roster.slice();
    await storeSet(STORAGE_PREFIX + 'lastClass', id);
    refreshAllPanels();
  }

  function refreshAllPanels(){
    $('#rosterInput').value = roster.join('\n');
    updateRosterCount();
    buildBallField();
    hideBanner();
    renderGroupsGrid([]);
    renderSeatGrid([], 0, 0);
    renderPoints();
  }

  function renderClassPicker(){
    const sel = $('#classPicker');
    sel.innerHTML = '';
    classes.forEach(c=>{
      const opt = document.createElement('option');
      opt.value = c.id; opt.textContent = c.name;
      if(c.id === currentClassId) opt.selected = true;
      sel.appendChild(opt);
    });
  }

  // ---------------- NAV ----------------
  function bindNav(){
    $$('.tool-btn').forEach(btn=>{
      btn.addEventListener('click', ()=> showPanel(btn.dataset.panel));
    });
    $('#classPicker').addEventListener('change', async (e)=>{
      await loadClass(e.target.value);
    });
    $('#newClassBtn').addEventListener('click', async ()=>{
      const name = prompt('Name this class (e.g. "Period 3", "Room 12"):');
      if(!name) return;
      const id = uid();
      classes.push({id, name});
      await storeSet(STORAGE_PREFIX + 'classes', classes);
      await storeSet(STORAGE_PREFIX + 'roster:' + id, []);
      renderClassPicker();
      $('#classPicker').value = id;
      await loadClass(id);
      showPanel('roster');
    });
  }

  function showPanel(name){
    $$('.panel').forEach(p=> p.classList.remove('active'));
    $('#panel-' + name).classList.add('active');
    $$('.tool-btn').forEach(b=> b.classList.toggle('active', b.dataset.panel === name));
  }

  // ---------------- ROSTER ----------------
  function bindRoster(){
    $('#rosterInput').addEventListener('input', updateRosterCount);
    $('#saveRosterBtn').addEventListener('click', async ()=>{
      roster = $('#rosterInput').value.split('\n').map(s=>s.trim()).filter(Boolean);
      await storeSet(STORAGE_PREFIX + 'roster:' + currentClassId, roster);
      pickerPool = roster.slice();
      buildBallField();
      hideBanner();
      renderPoints();
      updateRosterCount();
    });
    $('#deleteClassBtn').addEventListener('click', async ()=>{
      if(classes.length <= 1){ alert("You need at least one class."); return; }
      if(!confirm('Delete this class and its saved data? This cannot be undone.')) return;
      await storeDelete(STORAGE_PREFIX + 'roster:' + currentClassId);
      await storeDelete(STORAGE_PREFIX + 'points:' + currentClassId);
      classes = classes.filter(c=>c.id !== currentClassId);
      await storeSet(STORAGE_PREFIX + 'classes', classes);
      renderClassPicker();
      await loadClass(classes[0].id);
    });
  }
  function updateRosterCount(){
    const n = $('#rosterInput').value.split('\n').map(s=>s.trim()).filter(Boolean).length;
    $('#rosterCount').textContent = n + (n===1 ? ' student' : ' students');
  }

  // ---------------- PICKER: PLINKO BALL DROP ----------------
  let ctx, W, H;
  let pegs = [];
  const MARGIN_X = 24, MARGIN_TOP = 26, MARGIN_BOTTOM = 46;
  const PEG_R = 4, BALL_R = 7;
  let FINISH_Y = 0;   // the real finish line — only the winner (or, later, everyone) crosses this
  let HOLD_Y = 0;     // an invisible barrier above the finish line where non-winners bounce back
  let PLAY_BOTTOM = 0; // the peg field stops here, leaving an open chute down to the finish line

  // Physics tuning. Simulation runs in fixed-size substeps (see SUBSTEP_DT
  // below) so collisions stay accurate regardless of the browser's actual
  // frame rate — a ball can't "tunnel" through a peg between frames.
  const GRAVITY = 170;          // px/s^2
  const MAX_FALL_SPEED = 210;   // px/s, terminal velocity
  const JITTER = 18;            // px/s^2, random horizontal wobble
  const DAMPING = 0.99;         // per-substep horizontal drag
  const WALL_KICK = 8;          // px/s, bounce-off-wall boost
  const PEG_BOUNCE = 1.5;       // reflection strength off pegs
  const PEG_KICK = 45;          // px/s, random kick added on peg hit
  const PEG_VY_DAMPING = 0.55;  // vertical damping after a peg hit
  const SUBSTEP_DT = 1/240;     // fixed physics step (240Hz) for accuracy
  const MAX_SUBSTEPS_PER_FRAME = 8;

  function initCanvas(){
    const canvas = $('#plinkoCanvas');
    ctx = canvas.getContext('2d');
    W = canvas.width; H = canvas.height;
    FINISH_Y = H - MARGIN_BOTTOM;
    HOLD_Y = FINISH_Y - 34;
    PLAY_BOTTOM = FINISH_Y - 66;
  }

  function generatePegs(){
    initCanvas();
    pegs = [];
    const rows = 8;
    const spacingX = 34;
    const spacingY = (PLAY_BOTTOM - MARGIN_TOP) / (rows - 1);
    const cols = Math.floor((W - 2*MARGIN_X) / spacingX);
    for(let r=0;r<rows;r++){
      const y = MARGIN_TOP + r*spacingY;
      const offset = (r % 2 === 0) ? 0 : spacingX/2;
      for(let c=0;c<cols;c++){
        const x = MARGIN_X + offset + c*spacingX;
        if(x <= W - MARGIN_X) pegs.push({x,y});
      }
    }
  }

  function drawBoard(balls){
    ctx.clearRect(0,0,W,H);
    // pegs
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    pegs.forEach(p=>{
      ctx.beginPath();
      ctx.arc(p.x,p.y,PEG_R,0,Math.PI*2);
      ctx.fill();
    });
    // finish line
    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6,5]);
    ctx.beginPath();
    ctx.moveTo(0, FINISH_Y);
    ctx.lineTo(W, FINISH_Y);
    ctx.stroke();
    ctx.setLineDash([]);
    // balls
    (balls || []).forEach(b=>{
      ctx.beginPath();
      ctx.fillStyle = b.color;
      ctx.arc(b.x, b.y, BALL_R, 0, Math.PI*2);
      ctx.fill();
      ctx.font = '600 10px Inter, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.textAlign = 'center';
      const label = b.name.length > 10 ? b.name.slice(0,9)+'…' : b.name;
      ctx.fillText(label, b.x, b.y - BALL_R - 5);
    });
  }

  function bindPicker(){
    $('#raceBtn').addEventListener('click', startRace);
    $('#noRepeatCheckbox').addEventListener('change', (e)=>{
      $('#noRepeatSwitch').classList.toggle('on', e.target.checked);
      pickerPool = roster.slice();
      updatePoolNote();
    });
  }

  function buildBallField(){
    raceNames = roster.slice();
    const legend = $('#ballLegend');
    legend.innerHTML = '';
    raceNames.forEach((name,i)=>{
      const item = document.createElement('div');
      item.className = 'legend-item';
      const dot = document.createElement('span');
      dot.className = 'legend-dot';
      dot.style.background = PALETTE[i % PALETTE.length];
      item.appendChild(dot);
      const label = document.createElement('span');
      label.textContent = name;
      item.appendChild(label);
      legend.appendChild(item);
    });
    $('#raceBtn').disabled = raceNames.length === 0;
    drawBoard([]);
    updatePoolNote();
  }

  // Advance one ball by a single fixed substep. Returns true if the ball
  // crossed the finish line during this substep.
  function stepBall(b, dt, winnerName, winnerDone){
    if(b.finished) return false;

    b.vy = Math.min(b.vy + GRAVITY*dt, MAX_FALL_SPEED);
    b.vx += (Math.random()-0.5)*JITTER*dt;
    b.vx *= DAMPING;
    b.x += b.vx*dt;
    b.y += b.vy*dt;

    if(b.x < MARGIN_X+BALL_R){ b.x = MARGIN_X+BALL_R; b.vx = Math.abs(b.vx)*0.6+WALL_KICK; }
    if(b.x > W-MARGIN_X-BALL_R){ b.x = W-MARGIN_X-BALL_R; b.vx = -Math.abs(b.vx)*0.6-WALL_KICK; }

    // Resolve every overlapping peg this substep (not just the first),
    // so a ball wedged between two pegs still gets pushed out cleanly.
    for(const p of pegs){
      const dx = b.x-p.x, dy = b.y-p.y;
      const distSq = dx*dx+dy*dy;
      const minDist = BALL_R+PEG_R;
      if(distSq < minDist*minDist && distSq > 0.0001){
        const dist = Math.sqrt(distSq);
        const nx = dx/dist, ny = dy/dist;
        const overlap = minDist-dist;
        b.x += nx*overlap;
        b.y += ny*overlap;
        const dot = b.vx*nx+b.vy*ny;
        b.vx -= PEG_BOUNCE*dot*nx;
        b.vy -= PEG_BOUNCE*dot*ny;
        b.vx += (Math.random()-0.5)*PEG_KICK;
        b.vy *= PEG_VY_DAMPING;
      }
    }

    if(!winnerDone && b.name !== winnerName){
      // Held back: bounce off an invisible barrier before the real finish
      // line, so a non-winner can never appear to arrive before the winner.
      if(b.y+BALL_R >= HOLD_Y){
        b.y = HOLD_Y-BALL_R;
        b.vy = -Math.abs(b.vy)*0.4 - 30;
      }
      return false;
    }

    if(b.y+BALL_R >= FINISH_Y){
      b.finished = true;
      b.y = FINISH_Y-BALL_R;
      return b.name === winnerName;
    }
    return false;
  }

  function startRace(){
    if(racing || raceNames.length === 0) return;
    const noRepeat = $('#noRepeatCheckbox').checked;
    let pool = noRepeat ? pickerPool : raceNames;
    if(noRepeat && pool.length === 0){
      pickerPool = roster.slice();
      pool = pickerPool;
    }
    const winnerName = pool[Math.floor(Math.random()*pool.length)];

    racing = true;
    hideBanner();
    $('#raceBtn').disabled = true;

    const balls = raceNames.map((name,i)=>({
      name,
      color: PALETTE[i % PALETTE.length],
      x: W/2 + (Math.random()-0.5)*40,
      y: -10,
      vx: (Math.random()-0.5)*12,
      vy: 0,
      finished:false,
      releaseAt: i*70 // ms
    }));

    let winnerDone = false, winnerFinishAt = null;
    let elapsed = 0;
    let lastTime = performance.now();
    let carryOver = 0; // leftover ms not yet consumed by a fixed substep

    function frame(now){
      const frameDt = Math.min((now-lastTime)/1000, 0.05);
      lastTime = now;
      elapsed += frameDt*1000;

      carryOver += frameDt;
      let substeps = Math.min(Math.floor(carryOver/SUBSTEP_DT), MAX_SUBSTEPS_PER_FRAME);
      carryOver -= substeps*SUBSTEP_DT;

      while(substeps-- > 0){
        balls.forEach(b=>{
          if(elapsed < b.releaseAt) return;
          const crossed = stepBall(b, SUBSTEP_DT, winnerName, winnerDone);
          if(crossed && !winnerDone){
            winnerDone = true;
            winnerFinishAt = performance.now();
            showBanner(winnerName);
            spawnConfetti();
            if(noRepeat){
              pickerPool = pickerPool.filter(x=> x!==winnerName);
              updatePoolNote();
            }
          }
        });
      }

      drawBoard(balls);

      const settleDone = winnerDone && (now - winnerFinishAt > 900);
      if(!settleDone){
        requestAnimationFrame(frame);
      } else {
        racing = false;
        $('#raceBtn').disabled = false;
      }
    }
    requestAnimationFrame(frame);
  }

  function showBanner(name){
    const b = $('#winnerBanner');
    b.textContent = "It's " + name + "'s turn! 🎉";
    b.classList.add('show');
  }
  function hideBanner(){
    const b = $('#winnerBanner');
    b.classList.remove('show');
    b.textContent = '';
  }

  function spawnConfetti(){
    const banner = $('#winnerBanner');
    for(let i=0;i<18;i++){
      const piece = document.createElement('span');
      piece.className = 'confetti-piece';
      piece.style.left = (Math.random()*100) + '%';
      piece.style.background = CONFETTI_COLORS[Math.floor(Math.random()*CONFETTI_COLORS.length)];
      piece.style.animationDelay = (Math.random()*0.15) + 's';
      piece.style.animationDuration = (0.8 + Math.random()*0.5) + 's';
      banner.appendChild(piece);
      setTimeout(()=> piece.remove(), 1600);
    }
  }

  function updatePoolNote(){
    const noRepeat = $('#noRepeatCheckbox').checked;
    const note = $('#poolNote');
    if(!noRepeat || roster.length === 0){ note.textContent = ''; return; }
    note.textContent = pickerPool.length + ' of ' + roster.length + ' students left in this round.';
  }

  // ---------------- GROUPS ----------------
  function bindGroups(){
    $('#makeGroupsBtn').addEventListener('click', ()=>{
      const mode = $('#groupMode').value;
      const val = Math.max(1, parseInt($('#groupNumber').value) || 1);
      if(roster.length === 0){ renderGroupsGrid([]); return; }
      const shuffled = shuffle(roster.slice());
      let groups = [];
      if(mode === 'count'){
        groups = Array.from({length: val}, ()=>[]);
        shuffled.forEach((name, i)=> groups[i % val].push(name));
      } else {
        for(let i=0;i<shuffled.length;i+=val) groups.push(shuffled.slice(i,i+val));
      }
      renderGroupsGrid(groups);
    });
  }
  function renderGroupsGrid(groups){
    const grid = $('#groupsGrid');
    grid.innerHTML = '';
    if(groups.length === 0){
      grid.innerHTML = '<div class="empty-state">No groups yet — set your options and click "Make groups".</div>';
      return;
    }
    groups.forEach((g,i)=>{
      const card = document.createElement('div');
      card.className = 'group-card';
      card.style.animationDelay = (i*0.05) + 's';
      card.innerHTML = `<h3>Group ${i+1}</h3><ul>${g.map(n=>`<li>${escapeHtml(n)}</li>`).join('') || '<li>—</li>'}</ul>`;
      grid.appendChild(card);
    });
  }

  // ---------------- SEATING ----------------
  let seatAssignments = [];
  let selectedSeat = null;
  function bindSeating(){
    $('#genSeatingBtn').addEventListener('click', ()=>{
      const rows = Math.max(1, parseInt($('#seatRows').value)||1);
      const cols = Math.max(1, parseInt($('#seatCols').value)||1);
      const seats = rows*cols;
      const shuffled = shuffle(roster.slice());
      seatAssignments = Array.from({length:seats}, (_,i)=> shuffled[i] || null);
      selectedSeat = null;
      renderSeatGrid(seatAssignments, rows, cols);
      const leftover = shuffled.slice(seats);
      $('#leftoverNote').textContent = leftover.length ? ('Not enough seats for: ' + leftover.join(', ')) : '';
    });
  }
  function renderSeatGrid(assignments, rows, cols){
    const grid = $('#seatGrid');
    grid.innerHTML = '';
    if(assignments.length === 0){
      grid.style.gridTemplateColumns = '';
      grid.innerHTML = '<div class="empty-state">No layout yet — choose rows and columns, then generate.</div>';
      return;
    }
    grid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    assignments.forEach((name, i)=>{
      const seat = document.createElement('div');
      seat.className = 'seat' + (name ? '' : ' empty');
      seat.style.animationDelay = (i*0.015) + 's';
      seat.textContent = name || '(empty)';
      seat.dataset.index = i;
      seat.addEventListener('click', ()=> onSeatClick(i));
      grid.appendChild(seat);
    });
  }
  function onSeatClick(i){
    if(selectedSeat === null){
      selectedSeat = i;
      $$('.seat')[i].classList.add('selected');
    } else if(selectedSeat === i){
      $$('.seat')[i].classList.remove('selected');
      selectedSeat = null;
    } else {
      const tmp = seatAssignments[i];
      seatAssignments[i] = seatAssignments[selectedSeat];
      seatAssignments[selectedSeat] = tmp;
      $$('.seat')[selectedSeat].classList.remove('selected');
      const cols = parseInt($('#seatCols').value)||1;
      renderSeatGrid(seatAssignments, 0, cols);
      selectedSeat = null;
    }
  }

  // ---------------- TIMER ----------------
  let timerInterval = null;
  let timerRemaining = 300;
  function bindTimer(){
    updateTimerDisplay();
    $('#timerMin').addEventListener('change', syncTimerFromInputs);
    $('#timerSec').addEventListener('change', syncTimerFromInputs);
    $('#timerStartBtn').addEventListener('click', startTimer);
    $('#timerPauseBtn').addEventListener('click', ()=>{ clearInterval(timerInterval); timerInterval=null; });
    $('#timerResetBtn').addEventListener('click', ()=>{
      clearInterval(timerInterval); timerInterval=null;
      syncTimerFromInputs();
      $('#timerDisplay').classList.remove('done','urgent');
    });
  }
  function syncTimerFromInputs(){
    const m = Math.max(0, parseInt($('#timerMin').value)||0);
    const s = Math.min(59, Math.max(0, parseInt($('#timerSec').value)||0));
    timerRemaining = m*60+s;
    updateTimerDisplay();
  }
  function startTimer(){
    if(timerInterval) return;
    if(timerRemaining <= 0) syncTimerFromInputs();
    if(timerRemaining <= 0) return;
    $('#timerDisplay').classList.remove('done');
    timerInterval = setInterval(()=>{
      timerRemaining--;
      updateTimerDisplay();
      if(timerRemaining <= 0){
        clearInterval(timerInterval); timerInterval = null;
        $('#timerDisplay').classList.remove('urgent');
        $('#timerDisplay').classList.add('done');
        playBeep();
      }
    },1000);
  }
  function updateTimerDisplay(){
    const m = Math.floor(timerRemaining/60), s = timerRemaining%60;
    $('#timerDisplay').textContent = String(m).padStart(2,'0') + ':' + String(s).padStart(2,'0');
    $('#timerDisplay').classList.toggle('urgent', timerInterval !== null && timerRemaining > 0 && timerRemaining <= 10);
  }
  function playBeep(){
    try{
      const ctxA = new (window.AudioContext || window.webkitAudioContext)();
      [0,0.3,0.6].forEach(delay=>{
        const osc = ctxA.createOscillator();
        const gain = ctxA.createGain();
        osc.type = 'sine';
        osc.frequency.value = 880;
        gain.gain.value = 0.2;
        osc.connect(gain); gain.connect(ctxA.destination);
        osc.start(ctxA.currentTime + delay);
        osc.stop(ctxA.currentTime + delay + 0.2);
      });
    }catch(e){ /* audio not available */ }
  }

  // ---------------- NOISE ----------------
  let audioCtx=null, analyser=null, micStream=null, noiseRAF=null;
  let wasHot = false;
  function bindNoise(){
    $('#noiseToggleBtn').addEventListener('click', toggleMic);
    $('#noiseThreshold').addEventListener('input', (e)=>{
      $('#noiseThresholdMark').style.left = e.target.value + '%';
    });
  }
  async function toggleMic(){
    if(micStream){
      stopMic();
      return;
    }
    try{
      micStream = await navigator.mediaDevices.getUserMedia({audio:true});
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const source = audioCtx.createMediaStreamSource(micStream);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      $('#noiseToggleBtn').textContent = 'Turn off microphone';
      $('#noiseMsg').textContent = 'Listening…';
      loopNoise();
    }catch(e){
      $('#noiseMsg').textContent = "Couldn't access the microphone — check your browser permissions.";
    }
  }
  function stopMic(){
    if(noiseRAF) cancelAnimationFrame(noiseRAF);
    if(micStream) micStream.getTracks().forEach(t=>t.stop());
    if(audioCtx) audioCtx.close();
    micStream = null; audioCtx = null; analyser = null;
    $('#noiseToggleBtn').textContent = 'Turn on microphone';
    $('#noiseMsg').textContent = 'Mic is off';
    $('#noiseBarFill').style.width = '0%';
    $('#noiseWrap').classList.remove('hot');
    wasHot = false;
  }
  function loopNoise(){
    const data = new Uint8Array(analyser.fftSize);
    const tick = ()=>{
      analyser.getByteTimeDomainData(data);
      let sum=0;
      for(let i=0;i<data.length;i++){
        const v = (data[i]-128)/128;
        sum += v*v;
      }
      const rms = Math.sqrt(sum/data.length);
      const level = Math.min(100, Math.round(rms*260));
      $('#noiseBarFill').style.width = level + '%';
      const threshold = parseInt($('#noiseThreshold').value);
      const hot = level > threshold;
      $('#noiseWrap').classList.toggle('hot', hot);
      if(hot && !wasHot){
        const msg = $('#noiseMsg');
        msg.classList.remove('bump'); void msg.offsetWidth; msg.classList.add('bump');
      }
      wasHot = hot;
      $('#noiseMsg').textContent = hot ? "Whoa — let's bring it down a notch!" : 'Sounding good';
      noiseRAF = requestAnimationFrame(tick);
    };
    tick();
  }

  // ---------------- POINTS ----------------
  function bindPoints(){
    $('#resetPointsBtn').addEventListener('click', async ()=>{
      roster.forEach(n=> points[n] = 0);
      await storeSet(STORAGE_PREFIX + 'points:' + currentClassId, points);
      renderPoints();
    });
  }
  function bumpScore(el){
    el.classList.remove('bump');
    void el.offsetWidth;
    el.classList.add('bump');
  }
  function renderPoints(){
    const list = $('#pointsList');
    list.innerHTML = '';
    if(roster.length === 0){
      list.innerHTML = '<div class="empty-state">Add students in the class roster tab to start tracking points.</div>';
      return;
    }
    roster.forEach((name, i)=>{
      if(!(name in points)) points[name] = 0;
      const row = document.createElement('div');
      row.className = 'points-row';
      row.style.animationDelay = (i*0.02) + 's';
      row.innerHTML = `
        <span class="points-name">${escapeHtml(name)}</span>
        <span class="points-controls">
          <button class="pt-btn minus">–</button>
          <span class="pt-score">${points[name]}</span>
          <button class="pt-btn plus">+</button>
        </span>`;
      const scoreEl = row.querySelector('.pt-score');
      row.querySelector('.minus').addEventListener('click', async ()=>{
        points[name]--; scoreEl.textContent = points[name];
        bumpScore(scoreEl);
        await storeSet(STORAGE_PREFIX + 'points:' + currentClassId, points);
      });
      row.querySelector('.plus').addEventListener('click', async ()=>{
        points[name]++; scoreEl.textContent = points[name];
        bumpScore(scoreEl);
        await storeSet(STORAGE_PREFIX + 'points:' + currentClassId, points);
      });
      list.appendChild(row);
    });
  }

  // ---------------- HELPERS ----------------
  function shuffle(arr){
    for(let i=arr.length-1;i>0;i--){
      const j = Math.floor(Math.random()*(i+1));
      [arr[i],arr[j]] = [arr[j],arr[i]];
    }
    return arr;
  }
  function escapeHtml(s){
    return s.replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  init();
})();