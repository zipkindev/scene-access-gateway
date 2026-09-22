(() => {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const COLS = 8, ROWS = 8;
  const rowY = [389, 414, 442, 472, 505, 543, 585, 635, 695];
  const topY = [392, 391, 391, 390, 391, 390, 390, 390, 390];
  const bottomY = [696, 694, 693, 692, 692, 693, 695, 698, 700];
  const columnsX = [
    [542, 613, 683, 754, 827, 899, 971, 1045, 1118],
    [526, 601, 675, 750, 826, 903, 978, 1055, 1132],
    [510, 589, 667, 746, 826, 906, 985, 1066, 1147],
    [493, 576, 659, 742, 825, 909, 993, 1078, 1162],
    [474, 562, 650, 738, 825, 913, 1001, 1090, 1179],
    [452, 546, 640, 733, 825, 918, 1010, 1105, 1199],
    [429, 529, 629, 727, 824, 922, 1021, 1121, 1221],
    [400, 508, 616, 720, 824, 928, 1033, 1140, 1247],
    [369, 485, 600, 712, 823, 935, 1048, 1165, 1282],
  ];
  const catalog = [
    ['minesweeper', 'Minesweeper', '✦'], ['memory', 'Memory Constellations', '☌'],
    ['lights', 'Lights Out', '☼'], ['nonogram', 'Celestial Nonogram', '▦'],
    ['treasure', 'Treasure Path', '◇'], ['knight', 'Knight’s Tour', '♘'],
    ['pegs', 'Peg Solitaire', '◉'], ['reversi', 'Orbital Reversi', '◐'],
    ['four', 'Four in a Row', '⋮'], ['fusion', '2048 Fusion', '⊕'],
    ['classic2048', '2048 Standard', '4×4'], ['circuit', 'Celestial Circuit', '⌁'],
  ].map(([id, name, symbol]) => ({ id, name, symbol, ready: true }));
  const style = `
    .game-carousel-layer{position:absolute;inset:0;width:100%;height:100%;z-index:6;pointer-events:none;overflow:visible;outline:none}
    .game-carousel-layer .board-hit{fill:transparent;stroke:transparent;pointer-events:all;cursor:pointer;touch-action:none;outline:none}
    .game-carousel-layer .board-hit:focus,.game-carousel-layer .board-hit:focus-visible{outline:none}
    .game-carousel-layer .board-face{fill:transparent;stroke:transparent;pointer-events:none;transition:fill .16s,stroke .16s}
    .game-carousel-layer .lit{fill:#5edbec3c;stroke:#c9f9ff;stroke-width:1.35;filter:drop-shadow(0 0 7px #54d9ed)}
    .game-carousel-layer .gold{fill:#d8a74a40;stroke:#ffe3a0;stroke-width:1.25;filter:drop-shadow(0 0 6px #d69a3f)}
    .game-carousel-layer .dim{fill:#16354835;stroke:#6596a4;stroke-width:.7}.game-carousel-layer .marked{fill:#1b192855;stroke:#bca36c;stroke-dasharray:3 4;stroke-width:1}
    .game-carousel-layer .bad{fill:#a9324d66;stroke:#ff9eaa;stroke-width:1.4}.game-carousel-layer .dark{fill:#07141b66;stroke:#3a7582;stroke-width:.65}
    .game-carousel-layer .white{fill:#e8d9aeaa;stroke:#fff1c9;stroke-width:1.1}.game-carousel-layer .black{fill:#142632cc;stroke:#6fc6d4;stroke-width:1.1}
    .game-carousel-layer .possible{fill:#6bdced22;stroke:#8ae7ef;stroke-dasharray:2 4;stroke-width:.8}.game-carousel-layer .selected{fill:#f1c66f50;stroke:#fff1bd;stroke-width:1.7}
    .game-carousel-layer .keyboard-focus{stroke:#fff1bd;stroke-width:1.55;filter:drop-shadow(0 0 5px #6ddfec)}
    .game-carousel-layer .board-label{fill:#f3dfaa;filter:drop-shadow(1px 2px 1px #18100b);font-family:Georgia,serif;font-weight:700;paint-order:stroke fill;pointer-events:none;stroke:#493727;stroke-width:1.5;text-anchor:middle}
    .game-carousel-layer .board-label.cyan{fill:#c9f7ff;stroke:#174b5a}.game-carousel-layer .board-label.dark-text{fill:#17222a;stroke:#e9d8aa;stroke-width:.8}
    .game-carousel-layer .fusion-tile-moving{fill:#d8a74a40;stroke:#ffe3a0;stroke-width:1.25;pointer-events:none}
    .game-carousel-layer .fusion-moving{fill:#f3dfaa;filter:drop-shadow(1px 2px 1px #18100b);font-family:Georgia,serif;font-weight:700;paint-order:stroke fill;pointer-events:none;stroke:#493727;stroke-width:1.5;text-anchor:middle}
    .game-carousel-layer .fusion-merge-tile{fill:#e3b75458;stroke:#fff0b8;filter:drop-shadow(0 0 8px #e0a444)}
    .game-carousel-layer .fusion-merge-number{fill:#fff2bd;filter:drop-shadow(0 0 7px #efbd61)}
    .game-carousel-layer .game-clue{fill:#e8d29d;font:600 12px Georgia,serif;paint-order:stroke fill;stroke:#182028;stroke-width:2;pointer-events:none;text-anchor:middle}
    .game-carousel-layer .game-line{fill:none;stroke:#8fe7f0;stroke-width:1.3;stroke-dasharray:4 7;opacity:.78;pointer-events:none}.game-carousel-layer .game-node{fill:#fff0bd;filter:drop-shadow(0 0 7px #70e6fa);pointer-events:none}
    .game-carousel-layer .circuit-trace{fill:none;stroke:#bcae87;stroke-width:2.15;stroke-linecap:round;stroke-linejoin:round;opacity:.72;pointer-events:none}
    .game-carousel-layer .circuit-trace.powered{stroke:#c9f9ff;opacity:1;filter:drop-shadow(0 0 4px #54d9ed)}
    .game-carousel-layer .circuit-trace.core{stroke:#ffe6a5;stroke-width:2.8;filter:drop-shadow(0 0 5px #edb952)}
    .game-carousel-layer .circuit-trace.destination{stroke:#ffe6a5;filter:drop-shadow(0 0 6px #edb952)}
    .game-carousel-layer .game-wave{fill:none;stroke:#e8c47d;stroke-width:2;opacity:0;animation:carousel-wave 1.2s ease-out both;transform-box:fill-box;transform-origin:center}
    @keyframes carousel-wave{0%{opacity:.9;transform:scale(.1)}100%{opacity:0;transform:scale(7);stroke-width:.3}}
    @media(prefers-reduced-motion:reduce){.game-carousel-layer .board-face{transition:none}.game-carousel-layer .game-wave{display:none}}
  `;
  function el(name, attrs = {}) { const node = document.createElementNS(NS, name); for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value); return node; }
  function seamY(row, column) { return row === 0 ? topY[column] : row === ROWS ? bottomY[column] : rowY[row]; }
  function corners(column, row) { return [[columnsX[row][column], seamY(row, column)], [columnsX[row][column + 1], seamY(row, column + 1)], [columnsX[row + 1][column + 1], seamY(row + 1, column + 1)], [columnsX[row + 1][column], seamY(row + 1, column)]]; }
  function center(index) { const points = corners(index % COLS, Math.floor(index / COLS)); return [points.reduce((sum, point) => sum + point[0], 0) / 4, points.reduce((sum, point) => sum + point[1], 0) / 4]; }
  function largeCorners(column, row) { const left = column * 2, top = row * 2, right = left + 2, bottom = top + 2; return [[columnsX[top][left], seamY(top, left)], [columnsX[top][right], seamY(top, right)], [columnsX[bottom][right], seamY(bottom, right)], [columnsX[bottom][left], seamY(bottom, left)]]; }
  function largeCenter(index) { const points = largeCorners(index % 4, Math.floor(index / 4)); return [points.reduce((sum, point) => sum + point[0], 0) / 4, points.reduce((sum, point) => sum + point[1], 0) / 4]; }
  function inset(points, amount = 3.2) {
    const area = points.reduce((sum, point, index) => { const next = points[(index + 1) % points.length]; return sum + point[0] * next[1] - next[0] * point[1]; }, 0);
    const shifted = points.map((point, index) => {
      const next = points[(index + 1) % points.length], dx = next[0] - point[0], dy = next[1] - point[1], length = Math.hypot(dx, dy) || 1;
      const normal = area > 0 ? [-dy / length, dx / length] : [dy / length, -dx / length];
      return [[point[0] + normal[0] * amount, point[1] + normal[1] * amount], [dx, dy]];
    });
    return points.map((point, index) => {
      const [previousPoint, previousDirection] = shifted[(index + points.length - 1) % points.length], [currentPoint, currentDirection] = shifted[index];
      const denominator = previousDirection[0] * currentDirection[1] - previousDirection[1] * currentDirection[0];
      if (Math.abs(denominator) < .0001) return currentPoint;
      const qx = currentPoint[0] - previousPoint[0], qy = currentPoint[1] - previousPoint[1];
      const distance = (qx * currentDirection[1] - qy * currentDirection[0]) / denominator;
      return [previousPoint[0] + previousDirection[0] * distance, previousPoint[1] + previousDirection[1] * distance];
    });
  }
  function perspectiveInset(points) {
    const leftDepth = Math.hypot(points[3][0] - points[0][0], points[3][1] - points[0][1]);
    const rightDepth = Math.hypot(points[2][0] - points[1][0], points[2][1] - points[1][1]);
    return Math.max(1.5, Math.min(3.4, (leftDepth + rightDepth) * .0275));
  }
  function around(index, diagonals = false) { const x = index % 8, y = Math.floor(index / 8), result = []; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && (diagonals || !dx || !dy)) { const xx = x + dx, yy = y + dy; if (xx >= 0 && xx < 8 && yy >= 0 && yy < 8) result.push(yy * 8 + xx); } return result; }
  function treasurePath(level) {
    const targetLength=Math.min(14+level*3,48);
    function random(seed){let state=seed>>>0;return()=>{state+=0x6d2b79f5;let value=state;value=Math.imul(value^(value>>>15),value|1);value^=value+Math.imul(value^(value>>>7),value|61);return((value^(value>>>14))>>>0)/4294967296;};}
    const directions=[[1,0],[0,1],[-1,0],[0,-1]];
    for(let attempt=0;attempt<40;attempt++){
      const nextRandom=random(level*0x9e3779b1+attempt*0x85ebca6b),start=(level*19+attempt*23)%64,path=[start],visits=new Map([[start,1]]);let direction=directions[Math.floor(nextRandom()*4)],run=2+Math.floor(nextRandom()*4),guard=0,crossingsLeft=Math.min(3,Math.floor(level/3));
      while(path.length<targetLength&&guard++<500){const current=path.at(-1),previous=path.at(-2),cx=current%8,cy=Math.floor(current/8),limit=level>=3?2:1;let candidates=directions.map(([dx,dy])=>({dx,dy,index:(cy+dy)*8+cx+dx})).filter(item=>cx+item.dx>=0&&cx+item.dx<8&&cy+item.dy>=0&&cy+item.dy<8&&item.index!==previous&&(visits.get(item.index)||0)<limit&&(!visits.has(item.index)||crossingsLeft>0));if(!candidates.length)break;const forward=candidates.find(item=>item.dx===direction[0]&&item.dy===direction[1]);let chosen;if(forward&&run>0)chosen=forward;else{const crossings=level>=3?candidates.filter(item=>(visits.get(item.index)||0)>0):[];if(crossings.length&&nextRandom()<.32)chosen=crossings[Math.floor(nextRandom()*crossings.length)];else{const fresh=candidates.filter(item=>!visits.has(item.index));const pool=fresh.length?fresh:candidates;chosen=pool[Math.floor(nextRandom()*pool.length)];}}if(visits.has(chosen.index))crossingsLeft--;if(chosen.dx!==direction[0]||chosen.dy!==direction[1]){direction=[chosen.dx,chosen.dy];run=2+Math.floor(nextRandom()*(level>=5?5:4));}else run--;path.push(chosen.index);visits.set(chosen.index,(visits.get(chosen.index)||0)+1);}
      if(path.length===targetLength)return path;
    }
    const fallback=[];for(let row=0;row<8;row++){const columns=Array.from({length:8},(_,column)=>column);if(row%2)columns.reverse();columns.forEach(column=>fallback.push(row*8+column));}return fallback.slice(0,targetLength);
  }
  function runs(values) { const out = []; let count = 0; for (const value of values) { if (value) count++; else if (count) { out.push(count); count = 0; } } if (count) out.push(count); return out.length ? out.join('·') : '0'; }
  function installStyle() { if (document.getElementById('future-game-carousel-style')) return; const sheet = document.createElement('style'); sheet.id = 'future-game-carousel-style'; sheet.textContent = style; document.head.append(sheet); }

  function mount({ svg, target, image, title, detail, onControl, onGameSound }) {
    installStyle(); svg.setAttribute('class', 'game-carousel-layer'); svg.setAttribute('viewBox', '0 0 1672 941');
    let selection = 1, active = null, destroyed = false, menuTimer = 0; const timers = new Set();
    function later(fn, delay) { const timer = setTimeout(() => { timers.delete(timer); if (!destroyed) fn(); }, delay); timers.add(timer); return timer; }
    function clearTimers() { for (const timer of timers) clearTimeout(timer); timers.clear(); }
    function status(main, sub) { title.parentElement.hidden = false; title.textContent = main; detail.textContent = sub; }
    function wave(index) { const [x, y] = center(index); const node = el('ellipse', { class: 'game-wave', cx: x, cy: y, rx: 25, ry: 10 }); svg.append(node); later(() => node.remove(), 1300); }
    function createBoard(onPick, onMark = null) {
      svg.setAttribute('class', 'game-carousel-layer'); svg.replaceChildren(); const cells = [];
      for (let row = 0; row < 8; row++) for (let column = 0; column < 8; column++) {
        const index = row * 8 + column, points = corners(column, row), visual = inset(points, perspectiveInset(points)), [x, y] = center(index), size = 14 + row * 1.2;
        const group = el('g'), face = el('polygon', { class: 'board-face', points: visual.map((p) => p.join(',')).join(' ') }), label = el('text', { class: 'board-label', x, y: y + size * .34, style: `font-size:${size}px` }), hit = el('polygon', { class: 'board-hit', points: points.map((p) => p.join(',')).join(' '), tabindex: 0, role: 'button', 'aria-label': `Row ${row + 1}, column ${column + 1}` });
        hit.addEventListener('click', (event) => { event.stopPropagation(); onPick(index); });
        hit.addEventListener('contextmenu', (event) => { event.preventDefault(); event.stopPropagation(); onMark?.(index); });
        hit.addEventListener('focus', () => face.classList?.add('keyboard-focus'));
        hit.addEventListener('blur', () => face.classList?.remove('keyboard-focus'));
        hit.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); onPick(index); } else if (event.key.toLowerCase() === 'f') { event.preventDefault(); event.stopPropagation(); onMark?.(index); } });
        group.append(face, label, hit); svg.append(group); cells.push({ group, face, label, hit });
      }
      return { cells, paint(index, state = '', text = '', labelClass = '') { const cell = cells[index]; cell.face.setAttribute('class', `board-face ${state}`.trim()); cell.label.textContent = text; cell.label.setAttribute('class', `board-label ${labelClass}`.trim()); }, clear() { cells.forEach((_, index) => this.paint(index)); }, disable(index, disabled = true) { cells[index].hit.style.pointerEvents = disabled ? 'none' : 'all'; }, destroy() { svg.replaceChildren(); } };
    }
    function createLargeBoard(onPick) {
      svg.setAttribute('class', 'game-carousel-layer'); svg.replaceChildren(); const cells = [];
      for (let row = 0; row < 4; row++) for (let column = 0; column < 4; column++) {
        const index = row * 4 + column, points = largeCorners(column, row), visual = inset(points, 4.2), [x, y] = largeCenter(index), size = 23 + row * 2.4;
        const group = el('g'), face = el('polygon', { class: 'board-face', points: visual.map((p) => p.join(',')).join(' ') }), label = el('text', { class: 'board-label', x, y: y + size * .34, style: `font-size:${size}px` }), hit = el('polygon', { class: 'board-hit', points: points.map((p) => p.join(',')).join(' '), tabindex: 0, role: 'button', 'aria-label': `2048 row ${row + 1}, column ${column + 1}` });
        hit.addEventListener('click', (event) => { event.stopPropagation(); onPick(index); });
        hit.addEventListener('focus', () => face.classList?.add('keyboard-focus')); hit.addEventListener('blur', () => face.classList?.remove('keyboard-focus'));
        group.append(face, label, hit); svg.append(group); cells.push({ group, face, label, hit });
      }
      return { cells, paint(index, state = '', text = '', labelClass = '') { const cell = cells[index]; cell.face.setAttribute('class', `board-face ${state}`.trim()); cell.label.textContent = text; cell.label.setAttribute('class', `board-label ${labelClass}`.trim()); }, destroy() { svg.replaceChildren(); } };
    }
    function stop() { clearTimers(); active?.destroy?.(); active = null; svg.replaceChildren(); svg.setAttribute('class', 'game-carousel-layer'); }
    function showMenu(message = '') { title.parentElement?.setAttribute('data-mode','browse');const game = catalog[selection]; status(`${game.symbol}  ${game.name}`, message || '◀ browse · center planetary seal to play · browse ▶'); clearTimeout(menuTimer); }
    function move(direction) { stop(); selection = (selection + direction + catalog.length) % catalog.length; showMenu(); onControl?.(direction < 0 ? 'previous' : 'next', catalog[selection]); }
    function select() { const game = catalog[selection]; onControl?.('select', game); stop(); title.parentElement?.setAttribute('data-mode','playing');active = starters[game.id](); }

    const starters = {
      minesweeper() {
        if (!globalThis.SceneGame) { showMenu('Minesweeper module unavailable'); return { destroy() {} }; }
        return globalThis.SceneGame.mount(svg, (state) => status(state.finished ? state.won ? 'Minesweeper · constellation complete' : 'Minesweeper · star collapsed' : `Minesweeper · ${state.revealedCount} tiles revealed`, 'Medallions change game · center seal restarts'));
      },
      memory() {
        let round = 1, sequence = [], input = 0, accepting = false; const board = createBoard(choose);
        function flash(index, state, duration = 430) { board.paint(index, state); later(() => board.paint(index), duration); }
        function nextRound() { accepting = false; input = 0; const count = Math.min(8, round + 2), available = Array.from({ length: 64 }, (_, i) => i); for (let i = 63; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [available[i], available[j]] = [available[j], available[i]]; } sequence = available.slice(0, count); status(`Memory Constellations · round ${round}`, `Remember ${count} stars`); sequence.forEach((tile, order) => later(() => flash(tile, 'lit', 470), 650 + order * 620)); later(() => { accepting = true; status(`Memory Constellations · round ${round}`, 'Repeat the constellation'); }, 650 + count * 620); }
        function choose(index) { if (!accepting) return; const expected = sequence[input]; if (index !== expected) { accepting = false; flash(index, 'bad', 620); status(`Memory Constellations · round ${round}`, 'The constellation slipped · watch it again'); sequence.forEach((tile, order) => later(() => flash(tile, 'lit', 470), 900 + order * 620)); later(() => { input = 0; accepting = true; status(`Memory Constellations · round ${round}`, 'Repeat the constellation'); }, 900 + sequence.length * 620); return; } flash(index, 'gold'); input++; if (input < sequence.length) return status(`Memory Constellations · round ${round}`, `${input} of ${sequence.length} stars aligned`); accepting = false; const points = sequence.map(center); svg.append(el('polyline', { class: 'game-line', points: points.map((p) => p.join(',')).join(' ') })); points.forEach(([x, y]) => svg.append(el('circle', { class: 'game-node', cx: x, cy: y, r: 3 }))); wave(sequence.at(-1)); if (round >= 6) status('Memory Constellations · chart complete', 'Center seal starts a new chart'); else { round++; status('Memory Constellations', 'Constellation aligned'); later(nextRound, 1700); } }
        nextRound(); return { destroy: () => board.destroy() };
      },
      lights() {
        const state = Array(64).fill(false), board = createBoard(pick);
        [10, 18, 27, 36, 45].forEach((index) => { for (const tile of [index, ...around(index)]) state[tile] = !state[tile]; });
        function render() { state.forEach((on, i) => board.paint(i, on ? 'lit' : 'dark')); status('Lights Out', `${state.filter(Boolean).length} lights remain · extinguish every tile`); if (!state.some(Boolean)) { status('Lights Out · complete', 'The board has returned to starlight'); wave(27); } }
        function pick(index) { for (const tile of [index, ...around(index)]) state[tile] = !state[tile]; render(); } render(); return { destroy: () => board.destroy() };
      },
      nonogram() {
        const pattern = ['10000001','01000010','00100100','00011000','00011000','00100100','01000010','10000001'].join('').split('').map(Number), filled = Array(64).fill(false), marked = Array(64).fill(false); const board = createBoard(pick, mark);
        for (let row = 0; row < 8; row++) { const [x] = center(row * 8), clue = el('text', { class: 'game-clue', x: x - 54 - row * 3.5, y: center(row * 8)[1] + 4 }); clue.textContent = runs(pattern.slice(row * 8, row * 8 + 8)); svg.append(clue); }
        for (let col = 0; col < 8; col++) { const [x] = center(col); const clue = el('text', { class: 'game-clue', x, y: 374 }); clue.textContent = runs(Array.from({ length: 8 }, (_, row) => pattern[row * 8 + col])); svg.append(clue); }
        function render() { filled.forEach((value, i) => board.paint(i, value ? 'gold' : marked[i] ? 'marked' : '', marked[i] ? '·' : '')); const correct = pattern.every((value, i) => Boolean(value) === filled[i]); status(correct ? 'Celestial Nonogram · glyph revealed' : 'Celestial Nonogram', 'Left click fills · right click or F marks empty'); if (correct) wave(27); }
        function pick(i) { filled[i] = !filled[i]; marked[i] = false; render(); } function mark(i) { if (!filled[i]) marked[i] = !marked[i]; render(); } render(); return { destroy: () => board.destroy() };
      },
      treasure() {
        let stage=1,lives=3,path=[],revealed=new Set(),step=0,finished=false,transitioning=false,dragging=false,lastPoint=null,lastDragTile=null,ignoreClickUntil=0;const board=createBoard(pick);
        function beginStage(){path=treasurePath(stage);revealed=new Set([path[0]]);step=0;transitioning=true;render('watch the path · hint 1 of 2');const pace=Math.max(42,74-stage*2),roundDuration=path.length*pace+460;for(let round=0;round<2;round++){const trail=new Set(),base=200+round*roundDuration;for(let position=0;position<path.length;position++){later(()=>{trail.add(path[position]);render(`watch the gold trail · hint ${round+1} of 2`);trail.forEach(index=>board.paint(index,'gold','·'));board.paint(path[position],'gold','✦');},base+position*pace);}later(()=>render(round<1?'trail fading · retracing shortly':'trail fading · get ready'),base+path.length*pace+280);}later(()=>{transitioning=false;render('repeat the path from memory');},200+roundDuration*2);}
        function render(message='Find the next safe tile'){board.clear();revealed.forEach(index=>board.paint(index,'gold','◇'));board.paint(path.at(-1),'lit','✦');board.paint(path[step],'selected','●');status(`Treasure Path · stage ${stage}`,`Lives ${lives} · ${message}`);}
        function completeStage(){transitioning=true;lives++;render('vault reached · +1 life');wave(path.at(-1));later(()=>{stage++;beginStage();},1400);}
        function fail(index){lives--;board.paint(index,'bad','×');if(lives<=0){finished=true;for(let tile=0;tile<64;tile++)board.disable(tile,true);status(`Treasure Path · stage ${stage} · journey ended`,'0 lives · press the center seal to begin again');return;}status(`Treasure Path · stage ${stage}`,`Lives ${lives} · that tile leaves the path`);later(()=>{if(!finished)render();},520);}
        function choose(index){if(finished||transitioning)return true;if(index===path[step+1]){step++;revealed.add(index);render();if(step===path.length-1)completeStage();return true;}if(revealed.has(index))return true;fail(index);return false;}
        function pick(index){if(Date.now()<ignoreClickUntil)return;choose(index);}
        function scenePoint(event){const box=image.getBoundingClientRect();return[(event.clientX-box.left)*1672/box.width,(event.clientY-box.top)*941/box.height];}
        function contains(points,x,y){let inside=false;for(let index=0,previous=points.length-1;index<points.length;previous=index++){const[x1,y1]=points[index],[x2,y2]=points[previous],crosses=(y1>y)!==(y2>y)&&x<(x2-x1)*(y-y1)/(y2-y1)+x1;if(crosses)inside=!inside;}return inside;}
        function tileAt([x,y]){for(let index=0;index<64;index++)if(contains(corners(index%8,Math.floor(index/8)),x,y))return index;return null;}
        function traceTo(point){const from=lastPoint||point,distance=Math.hypot(point[0]-from[0],point[1]-from[1]),samples=Math.max(1,Math.ceil(distance/10));for(let sample=1;sample<=samples;sample++){const ratio=sample/samples,index=tileAt([from[0]+(point[0]-from[0])*ratio,from[1]+(point[1]-from[1])*ratio]);if(index!==null&&index!==lastDragTile){lastDragTile=index;if(!choose(index)){dragging=false;lastPoint=null;return;}}}lastPoint=point;}
        function pointerDown(event){if(finished||transitioning)return;event.preventDefault();dragging=true;lastPoint=null;lastDragTile=null;ignoreClickUntil=Date.now()+400;traceTo(scenePoint(event));}
        function pointerMove(event){if(!dragging)return;event.preventDefault();traceTo(scenePoint(event));}
        function pointerUp(){if(!dragging)return;dragging=false;lastPoint=null;lastDragTile=null;ignoreClickUntil=Date.now()+260;}
        svg.style.touchAction='none';svg.addEventListener('pointerdown',pointerDown);svg.addEventListener('pointermove',pointerMove);svg.addEventListener('pointerup',pointerUp);svg.addEventListener('pointercancel',pointerUp);beginStage();return{destroy(){svg.removeEventListener('pointerdown',pointerDown);svg.removeEventListener('pointermove',pointerMove);svg.removeEventListener('pointerup',pointerUp);svg.removeEventListener('pointercancel',pointerUp);svg.style.touchAction='';board.destroy();}};
      },
      knight() {
        let current = 27; const visited = new Set([current]), board = createBoard(pick); const moves = (i) => { const x = i % 8, y = Math.floor(i / 8); return [[1,2],[2,1],[-1,2],[-2,1],[1,-2],[2,-1],[-1,-2],[-2,-1]].map(([dx,dy]) => [x+dx,y+dy]).filter(([xx,yy]) => xx>=0&&xx<8&&yy>=0&&yy<8).map(([xx,yy])=>yy*8+xx).filter((n)=>!visited.has(n)); };
        function render() { board.clear(); visited.forEach((i) => board.paint(i, 'gold', '·')); board.paint(current, 'selected', '♘'); moves(current).forEach((i) => board.paint(i, 'possible')); status('Knight’s Tour', `${visited.size} of 64 tiles visited`); if (visited.size === 64) wave(current); }
        function pick(i) { if (!moves(current).includes(i)) { board.paint(i, 'bad'); return later(render, 450); } visited.add(i); current = i; render(); } render(); return { destroy: () => board.destroy() };
      },
      pegs() {
        const valid = Array.from({ length: 64 }, (_, i) => i).filter(i => { const x=i%8,y=Math.floor(i/8); return (x>=2&&x<=5)||(y>=2&&y<=5); }), pegs = new Set(valid.filter((i)=>i!==27)); let selected = null; const board = createBoard(pick); const validSet = new Set(valid);
        function jumpsFrom(index){if(!pegs.has(index))return[];const x=index%8,y=Math.floor(index/8);return[[2,0],[-2,0],[0,2],[0,-2]].map(([dx,dy])=>{const targetX=x+dx,targetY=y+dy,target=targetY*8+targetX,mid=(y+dy/2)*8+x+dx/2;return targetX>=0&&targetX<8&&targetY>=0&&targetY<8&&validSet.has(target)&&!pegs.has(target)&&pegs.has(mid)?target:null;}).filter(index=>index!==null);}
        function render() { for(let i=0;i<64;i++){ if(!validSet.has(i)){board.paint(i,'');board.disable(i,true);} else board.paint(i, pegs.has(i) ? i===selected?'selected':'gold' : 'dark', pegs.has(i)?'●':''); }const landings=selected===null?[]:jumpsFrom(selected);landings.forEach(index=>board.paint(index,'possible','○'));const instruction=selected===null?'Click a gold peg two spaces from the empty center':landings.length?'Now click a cyan outlined empty hole':'That peg has no jump · select another gold peg';status(pegs.size===1?'Peg Solitaire · one star remains':'Peg Solitaire',`${pegs.size} pegs remain · ${instruction}`); if(pegs.size===1) wave([...pegs][0]); }
        function pick(i) { if(pegs.has(i)){selected=i;return render();} if(selected===null)return; const sx=selected%8,sy=Math.floor(selected/8),tx=i%8,ty=Math.floor(i/8),dx=tx-sx,dy=ty-sy; if((Math.abs(dx)===2&&dy===0)||(Math.abs(dy)===2&&dx===0)){const mid=(sy+dy/2)*8+(sx+dx/2);if(pegs.has(mid)){pegs.delete(selected);pegs.delete(mid);pegs.add(i);selected=null;return render();}} board.paint(i,'bad'); later(render,450); } render(); return { destroy:()=>board.destroy() };
      },
      reversi() {
        const cells=Array(64).fill(0);cells[27]=2;cells[28]=1;cells[35]=1;cells[36]=2;let player=1,finished=false;const board=createBoard(pick);const dirs=[[-1,-1],[0,-1],[1,-1],[-1,0],[1,0],[-1,1],[0,1],[1,1]],corners=[0,7,56,63],danger=[1,6,8,9,14,15,48,49,54,55,57,62];
        function flips(index,p){if(cells[index])return[];const x=index%8,y=Math.floor(index/8),out=[];for(const[dx,dy]of dirs){let xx=x+dx,yy=y+dy,line=[];while(xx>=0&&xx<8&&yy>=0&&yy<8&&cells[yy*8+xx]===3-p){line.push(yy*8+xx);xx+=dx;yy+=dy;}if(line.length&&xx>=0&&xx<8&&yy>=0&&yy<8&&cells[yy*8+xx]===p)out.push(...line);}return out;}
        function legal(p){return cells.map((_,i)=>flips(i,p).length?i:-1).filter(i=>i>=0);}
        function place(index,p){const captured=flips(index,p);if(!captured.length)return false;cells[index]=p;captured.forEach(i=>cells[i]=p);return true;}
        function render(){const possible=finished||player===2?[]:legal(1);for(let i=0;i<64;i++)board.paint(i,cells[i]===1?'white':cells[i]===2?'black':'',cells[i]?'●':'',cells[i]===1?'dark-text':'cyan');possible.forEach(i=>board.paint(i,'possible'));const gold=cells.filter(v=>v===1).length,cyan=cells.filter(v=>v===2).length;status(finished?'Orbital Reversi · orbit complete':player===2?'Orbital Reversi · celestial opponent thinking':'Orbital Reversi · your gold turn',`Gold ${gold} · Cyan AI ${cyan}`);if(finished)wave(27);}
        function finishOrContinue(next){const nextMoves=legal(next);if(nextMoves.length){player=next;render();if(player===2)later(aiTurn,520);return;}const other=3-next;if(legal(other).length){player=other;render();if(player===2)later(aiTurn,520);return;}finished=true;render();}
        function aiTurn(){if(finished||player!==2)return;const moves=legal(2),move=moves.map(index=>{const x=index%8,y=Math.floor(index/8);let score=flips(index,2).length*5;if(corners.includes(index))score+=1000;if(x===0||x===7||y===0||y===7)score+=35;if(danger.includes(index)&&!corners.some(c=>Math.abs(c%8-x)<=1&&Math.abs(Math.floor(c/8)-y)<=1&&cells[c]===2))score-=80;return{index,score};}).sort((a,b)=>b.score-a.score)[0]?.index;if(move===undefined){finishOrContinue(1);return;}place(move,2);finishOrContinue(1);}
        function pick(index){if(finished||player!==1||!place(index,1))return;finishOrContinue(2);}render();return{destroy:()=>board.destroy()};
      },
      four() {
        const cells=Array(64).fill(0);let player=1,finished=false;const board=createBoard(pick),directions=[[1,0],[0,1],[1,1],[1,-1]];
        function landing(column){for(let row=7;row>=0;row--)if(!cells[row*8+column])return row*8+column;return-1;}
        function won(index,p){const x=index%8,y=Math.floor(index/8);return directions.some(([dx,dy])=>{let count=1;for(const sign of[-1,1]){let xx=x+dx*sign,yy=y+dy*sign;while(xx>=0&&xx<8&&yy>=0&&yy<8&&cells[yy*8+xx]===p){count++;xx+=dx*sign;yy+=dy*sign;}}return count>=4;});}
        function openColumns(){return Array.from({length:8},(_,column)=>column).filter(column=>landing(column)>=0);}
        function evaluate(){let score=0;for(const[dx,dy]of directions)for(let y=0;y<8;y++)for(let x=0;x<8;x++){const endX=x+dx*3,endY=y+dy*3;if(endX<0||endX>=8||endY<0||endY>=8)continue;const window=Array.from({length:4},(_,step)=>cells[(y+dy*step)*8+x+dx*step]),ai=window.filter(v=>v===2).length,human=window.filter(v=>v===1).length;if(!human)score+=[0,2,14,90,10000][ai];if(!ai)score-=[0,2,16,120,10000][human];}return score;}
        function search(depth,turn,alpha,beta){const columns=openColumns();if(!depth||!columns.length)return evaluate();if(turn===2){let best=-Infinity;for(const column of columns){const index=landing(column);cells[index]=2;const value=won(index,2)?10000+depth:search(depth-1,1,alpha,beta);cells[index]=0;best=Math.max(best,value);alpha=Math.max(alpha,best);if(beta<=alpha)break;}return best;}let best=Infinity;for(const column of columns){const index=landing(column);cells[index]=1;const value=won(index,1)?-10000-depth:search(depth-1,2,alpha,beta);cells[index]=0;best=Math.min(best,value);beta=Math.min(beta,best);if(beta<=alpha)break;}return best;}
        function chooseAI(){return openColumns().map(column=>{const index=landing(column);cells[index]=2;const score=won(index,2)?20000:search(3,1,-Infinity,Infinity)-Math.abs(column-3.5);cells[index]=0;return{column,score};}).sort((a,b)=>b.score-a.score)[0]?.column;}
        function render(){cells.forEach((v,i)=>board.paint(i,v===1?'gold':v===2?'lit':'',v?'●':''));status(finished?'Four in a Row · alignment complete':player===2?'Four in a Row · celestial opponent thinking':'Four in a Row · your gold turn',finished?'Start again with the center seal':'Choose any tile in a column');}
        function aiTurn(){if(finished||player!==2)return;const column=chooseAI();if(column===undefined){finished=true;render();return;}const index=landing(column);cells[index]=2;if(won(index,2)){finished=true;render();wave(index);return;}if(!openColumns().length){finished=true;render();return;}player=1;render();}
        function pick(index){if(finished||player!==1)return;const target=landing(index%8);if(target<0)return;cells[target]=1;if(won(target,1)){finished=true;render();wave(target);return;}if(!openColumns().length){finished=true;render();return;}player=2;render();later(aiTurn,480);}render();return{destroy:()=>board.destroy()};
      },
      fusion() {
        const values=Array(64).fill(0);let selected=null,score=0,swipeStart=null,ignoreClickUntil=0,animating=false;const board=createBoard(pick);
        function empty(){return values.map((v,i)=>v?null:i).filter(v=>v!==null);}
        function spawn(){const slots=empty();if(!slots.length)return;values[slots[Math.floor(Math.random()*slots.length)]]=Math.random()<.85?2:4;}
        function lines(direction){const result=[];if(direction==='left'||direction==='right'){for(let row=0;row<8;row++){const line=Array.from({length:8},(_,col)=>row*8+col);result.push(direction==='right'?line.reverse():line);}}else{for(let col=0;col<8;col++){const line=Array.from({length:8},(_,row)=>row*8+col);result.push(direction==='down'?line.reverse():line);}}return result;}
        function animateMoves(motions,complete){if(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches){complete();return;}const moving=motions.filter(motion=>motion.from!==motion.to),ghosts=moving.map(motion=>{const[startX,startCenterY]=center(motion.from),[endX,endCenterY]=center(motion.to),startSize=14+Math.floor(motion.from/8)*1.2,endSize=14+Math.floor(motion.to/8)*1.2,startY=startCenterY+startSize*.34,endY=endCenterY+endSize*.34,startPoints=inset(corners(motion.from%8,Math.floor(motion.from/8))),endPoints=inset(corners(motion.to%8,Math.floor(motion.to/8))),tile=el('polygon',{class:`fusion-tile-moving${motion.merging?' fusion-merge-tile':''}`,points:startPoints.map(point=>point.join(',')).join(' ')}),number=el('text',{class:`fusion-moving${motion.merging?' fusion-merge-number':''}`,x:startX,y:startY,style:`font-size:${startSize}px`});number.textContent=String(motion.value);svg.append(tile,number);return{tile,number,startX,startY,endX,endY,startSize,endSize,startPoints,endPoints};}),hidden=new Set(moving.map(motion=>motion.from)),affected=new Set(moving.flatMap(motion=>[motion.from,motion.to]));affected.forEach(index=>{board.cells[index].face.style.transition='none';});hidden.forEach(index=>{board.cells[index].face.setAttribute('opacity','0');board.cells[index].label.setAttribute('opacity','0');});let frame=0;const frames=11;function step(){frame++;const raw=Math.min(1,frame/frames),progress=1-Math.pow(1-raw,3);for(const item of ghosts){item.number.setAttribute('x',item.startX+(item.endX-item.startX)*progress);item.number.setAttribute('y',item.startY+(item.endY-item.startY)*progress);item.number.style.fontSize=`${item.startSize+(item.endSize-item.startSize)*progress}px`;item.tile.setAttribute('points',item.startPoints.map((point,index)=>[point[0]+(item.endPoints[index][0]-point[0])*progress,point[1]+(item.endPoints[index][1]-point[1])*progress].join(',')).join(' '));}if(frame<frames){later(step,16);return;}complete();hidden.forEach(index=>{board.cells[index].face.setAttribute('opacity','1');board.cells[index].label.setAttribute('opacity','1');});ghosts.forEach(item=>{item.tile.remove();item.number.remove();});later(()=>affected.forEach(index=>{board.cells[index].face.style.transition='';}),0);}later(step,16);}
        function slide(direction){if(animating)return;let changed=false;const motions=[],next=values.slice();for(const line of lines(direction)){const compact=line.map(index=>({value:values[index],sources:[index]})).filter(item=>item.value),merged=[];for(let i=0;i<compact.length;i++){if(compact[i].value===compact[i+1]?.value){const value=compact[i].value*2;merged.push({value,sources:[...compact[i].sources,...compact[i+1].sources],merging:true});score+=value;i++;}else merged.push(compact[i]);}const output=merged.map(item=>item.value);while(output.length<8)output.push(0);line.forEach((index,position)=>{if(values[index]!==output[position])changed=true;next[index]=output[position];});merged.forEach((item,position)=>item.sources.forEach(from=>motions.push({from,to:line[position],value:item.value/item.sources.length,merging:!!item.merging})));}selected=null;if(!changed){render();return;}onGameSound?.('2048-move',{merged:motions.some(motion=>motion.merging)});animating=true;animateMoves(motions,()=>{next.forEach((value,index)=>values[index]=value);spawn();animating=false;render();});}
        function render(){values.forEach((v,i)=>board.paint(i,v?i===selected?'selected':v>=64?'lit':'gold':'',v?String(v):'',v>=64?'cyan':''));status(values.includes(2048)?'2048 Fusion · stellar core formed':'2048 Fusion',`Score ${score} · swipe/drag or use arrow keys`);if(values.includes(2048))wave(values.indexOf(2048));}
        function pick(i){if(animating||Date.now()<ignoreClickUntil)return;if(!values[i]){selected=null;return render();}if(selected===null){selected=i;return render();}if(around(selected).includes(i)&&values[i]===values[selected]){values[i]*=2;score+=values[i];values[selected]=0;selected=null;onGameSound?.('2048-move',{merged:true});spawn();render();}else{selected=i;render();}}
        function pointerDown(event){if(!animating)swipeStart=[event.clientX,event.clientY];}
        function pointerUp(event){if(!swipeStart)return;const dx=event.clientX-swipeStart[0],dy=event.clientY-swipeStart[1];swipeStart=null;if(Math.max(Math.abs(dx),Math.abs(dy))<24)return;event.preventDefault();event.stopPropagation();ignoreClickUntil=Date.now()+350;slide(Math.abs(dx)>Math.abs(dy)?dx>0?'right':'left':dy>0?'down':'up');}
        function keyDown(event){const direction={ArrowLeft:'left',ArrowRight:'right',ArrowUp:'up',ArrowDown:'down'}[event.key];if(!direction)return;event.preventDefault();event.stopPropagation();slide(direction);}
        svg.setAttribute('tabindex','0');svg.setAttribute('aria-label','2048 Fusion board. Swipe, drag, or use arrow keys.');svg.style.touchAction='none';svg.addEventListener('pointerdown',pointerDown);svg.addEventListener('pointerup',pointerUp);svg.addEventListener('keydown',keyDown);spawn();spawn();render();svg.focus?.({preventScroll:true});
        return{destroy(){svg.removeEventListener('pointerdown',pointerDown);svg.removeEventListener('pointerup',pointerUp);svg.removeEventListener('keydown',keyDown);svg.style.touchAction='';board.destroy();}};
      },
      classic2048() {
        const values=Array(16).fill(0);let score=0,swipeStart=null,animating=false;const board=createLargeBoard(()=>svg.focus?.({preventScroll:true}));
        function empty(){return values.map((value,index)=>value?null:index).filter(value=>value!==null);}
        function spawn(){const slots=empty();if(!slots.length)return;values[slots[Math.floor(Math.random()*slots.length)]]=Math.random()<.9?2:4;}
        function lines(direction){const result=[];if(direction==='left'||direction==='right'){for(let row=0;row<4;row++){const line=Array.from({length:4},(_,column)=>row*4+column);result.push(direction==='right'?line.reverse():line);}}else{for(let column=0;column<4;column++){const line=Array.from({length:4},(_,row)=>row*4+column);result.push(direction==='down'?line.reverse():line);}}return result;}
        function hasMove(){if(empty().length)return true;for(let index=0;index<16;index++){const x=index%4,y=Math.floor(index/4),value=values[index];if(x<3&&values[index+1]===value)return true;if(y<3&&values[index+4]===value)return true;}return false;}
        function render(){values.forEach((value,index)=>board.paint(index,value?value>=128?'lit':'gold':'',value?String(value):'',value>=128?'cyan':''));const won=values.includes(2048),finished=!hasMove();status(won?'2048 Standard · stellar core formed':finished?'2048 Standard · no moves remain':'2048 Standard',`Score ${score} · 4×4 · swipe/drag or use arrow keys`);if(won){const[x,y]=largeCenter(values.indexOf(2048)),ring=el('ellipse',{class:'game-wave',cx:x,cy:y,rx:45,ry:20});svg.append(ring);later(()=>ring.remove(),1300);}}
        function animateMoves(motions,complete){if(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches){complete();return;}const moving=motions.filter(motion=>motion.from!==motion.to),ghosts=moving.map(motion=>{const[startX,startCenterY]=largeCenter(motion.from),[endX,endCenterY]=largeCenter(motion.to),startSize=23+Math.floor(motion.from/4)*2.4,endSize=23+Math.floor(motion.to/4)*2.4,startY=startCenterY+startSize*.34,endY=endCenterY+endSize*.34,startPoints=inset(largeCorners(motion.from%4,Math.floor(motion.from/4)),4.2),endPoints=inset(largeCorners(motion.to%4,Math.floor(motion.to/4)),4.2),tile=el('polygon',{class:`fusion-tile-moving${motion.merging?' fusion-merge-tile':''}`,points:startPoints.map(point=>point.join(',')).join(' ')}),number=el('text',{class:`fusion-moving${motion.merging?' fusion-merge-number':''}`,x:startX,y:startY,style:`font-size:${startSize}px`});number.textContent=String(motion.value);svg.append(tile,number);return{tile,number,startX,startY,endX,endY,startSize,endSize,startPoints,endPoints};}),hidden=new Set(moving.map(motion=>motion.from)),affected=new Set(moving.flatMap(motion=>[motion.from,motion.to]));affected.forEach(index=>board.cells[index].face.style.transition='none');hidden.forEach(index=>{board.cells[index].face.setAttribute('opacity','0');board.cells[index].label.setAttribute('opacity','0');});let frame=0;function step(){frame++;const raw=Math.min(1,frame/11),progress=1-Math.pow(1-raw,3);for(const item of ghosts){item.number.setAttribute('x',item.startX+(item.endX-item.startX)*progress);item.number.setAttribute('y',item.startY+(item.endY-item.startY)*progress);item.number.style.fontSize=`${item.startSize+(item.endSize-item.startSize)*progress}px`;item.tile.setAttribute('points',item.startPoints.map((point,index)=>[point[0]+(item.endPoints[index][0]-point[0])*progress,point[1]+(item.endPoints[index][1]-point[1])*progress].join(',')).join(' '));}if(frame<11){later(step,16);return;}complete();hidden.forEach(index=>{board.cells[index].face.setAttribute('opacity','1');board.cells[index].label.setAttribute('opacity','1');});ghosts.forEach(item=>{item.tile.remove();item.number.remove();});later(()=>affected.forEach(index=>board.cells[index].face.style.transition=''),0);}later(step,16);}
        function slide(direction){if(animating)return;let changed=false;const motions=[],next=values.slice();for(const line of lines(direction)){const compact=line.map(index=>({value:values[index],sources:[index]})).filter(item=>item.value),merged=[];for(let index=0;index<compact.length;index++){if(compact[index].value===compact[index+1]?.value){const value=compact[index].value*2;merged.push({value,sources:[...compact[index].sources,...compact[index+1].sources],merging:true});score+=value;index++;}else merged.push(compact[index]);}const output=merged.map(item=>item.value);while(output.length<4)output.push(0);line.forEach((index,position)=>{if(values[index]!==output[position])changed=true;next[index]=output[position];});merged.forEach((item,position)=>item.sources.forEach(from=>motions.push({from,to:line[position],value:item.value/item.sources.length,merging:!!item.merging})));}if(!changed){render();return;}onGameSound?.('2048-move',{merged:motions.some(motion=>motion.merging)});animating=true;animateMoves(motions,()=>{next.forEach((value,index)=>values[index]=value);spawn();animating=false;render();});}
        function pointerDown(event){if(!animating)swipeStart=[event.clientX,event.clientY];}
        function pointerUp(event){if(!swipeStart)return;const dx=event.clientX-swipeStart[0],dy=event.clientY-swipeStart[1];swipeStart=null;if(Math.max(Math.abs(dx),Math.abs(dy))<24)return;event.preventDefault();event.stopPropagation();slide(Math.abs(dx)>Math.abs(dy)?dx>0?'right':'left':dy>0?'down':'up');}
        function keyDown(event){const direction={ArrowLeft:'left',ArrowRight:'right',ArrowUp:'up',ArrowDown:'down'}[event.key];if(!direction)return;event.preventDefault();event.stopPropagation();slide(direction);}
        svg.setAttribute('tabindex','0');svg.setAttribute('aria-label','Standard 2048 four by four board. Swipe, drag, or use arrow keys.');svg.style.touchAction='none';svg.addEventListener('pointerdown',pointerDown);svg.addEventListener('pointerup',pointerUp);svg.addEventListener('keydown',keyDown);spawn();spawn();render();svg.focus?.({preventScroll:true});
        return{destroy(){svg.removeEventListener('pointerdown',pointerDown);svg.removeEventListener('pointerup',pointerUp);svg.removeEventListener('keydown',keyDown);svg.style.touchAction='';board.destroy();}};
      },
      circuit() {
        const connections=[[1,0,-1,4],[2,1,0,8],[4,0,1,1],[8,-1,0,2]],source=27,levels=[{tiles:12,targets:1},{tiles:18,targets:1},{tiles:24,targets:1},{tiles:31,targets:2},{tiles:39,targets:2},{tiles:47,targets:2},{tiles:55,targets:3},{tiles:62,targets:3}],rotate=(mask)=>((mask<<1)&15)|((mask>>3)&1);let stage=1,solved,current,visited,targets,transitioning=false;
        const board=createBoard(pick),traces=board.cells.map(cell=>{const trace=el('path',{class:'circuit-trace'});cell.group.append(trace);return trace;});
        function buildLevel(number){stage=number;const config=levels[stage-1];solved=Array(64).fill(0);visited=new Set([source]);const route=[source];let seed=0x51c317+stage*0x9e3779b1;const nextRandom=()=>{seed+=0x6d2b79f5;let value=seed;value=Math.imul(value^(value>>>15),value|1);value^=value+Math.imul(value^(value>>>7),value|61);return((value^(value>>>14))>>>0)/4294967296;};while(route.length&&visited.size<config.tiles){const from=route[route.length-1],x=from%8,y=Math.floor(from/8),choices=connections.map(([bit,dx,dy,opposite])=>({bit,opposite,xx:x+dx,yy:y+dy})).filter(edge=>edge.xx>=0&&edge.xx<8&&edge.yy>=0&&edge.yy<8&&!visited.has(edge.yy*8+edge.xx));if(!choices.length){route.pop();continue;}const edge=choices[Math.floor(nextRandom()*choices.length)],to=edge.yy*8+edge.xx;solved[from]|=edge.bit;solved[to]|=edge.opposite;visited.add(to);route.push(to);}const distance=new Map([[source,0]]),queue=[source];while(queue.length){const index=queue.shift(),x=index%8,y=Math.floor(index/8);for(const[bit,dx,dy]of connections){if(!(solved[index]&bit))continue;const next=(y+dy)*8+x+dx;if(!distance.has(next)){distance.set(next,distance.get(index)+1);queue.push(next);}}}targets=[...visited].filter(index=>index!==source&&[1,2,4,8].filter(bit=>solved[index]&bit).length===1).sort((a,b)=>distance.get(b)-distance.get(a)).slice(0,config.targets);current=solved.map((mask,index)=>{let value=mask;for(let turn=0;turn<(index*7+stage*3)%4;turn++)value=rotate(value);return value;});transitioning=false;render();}
        function tracePath(index,mask){const points=corners(index%8,Math.floor(index/8)),[x,y]=center(index),edges=[[(points[0][0]+points[1][0])/2,(points[0][1]+points[1][1])/2],[(points[1][0]+points[2][0])/2,(points[1][1]+points[2][1])/2],[(points[2][0]+points[3][0])/2,(points[2][1]+points[3][1])/2],[(points[3][0]+points[0][0])/2,(points[3][1]+points[0][1])/2]];return[1,2,4,8].map((bit,direction)=>mask&bit?`M ${x} ${y} L ${edges[direction][0]} ${edges[direction][1]}`:'').filter(Boolean).join(' ');}
        function energized(){const reached=new Set([source]),queue=[source];while(queue.length){const index=queue.shift(),x=index%8,y=Math.floor(index/8);for(const[bit,dx,dy,opposite]of connections){if(!(current[index]&bit))continue;const xx=x+dx,yy=y+dy;if(xx<0||xx>=8||yy<0||yy>=8)continue;const next=yy*8+xx;if((current[next]&opposite)&&!reached.has(next)){reached.add(next);queue.push(next);}}}return reached;}
        function render(){const powered=energized(),complete=targets.every(index=>powered.has(index));current.forEach((value,index)=>{const destination=targets.includes(index),state=value?(destination?(powered.has(index)?'lit selected':'gold'):(powered.has(index)?'lit':'dark')):'';board.paint(index,state,destination?'✦':'',powered.has(index)?'cyan':'');traces[index].setAttribute('d',tracePath(index,value));traces[index].setAttribute('class',`circuit-trace${powered.has(index)&&value?' powered':''}${index===source?' core':''}${destination?' destination':''}`);});board.paint(source,'lit selected','◆','cyan');if(complete){const final=stage===levels.length;status(final?'Celestial Circuit · constellation mastered':`Celestial Circuit · level ${stage} complete`,final?'Every destination crystal is alive':`Energy reached ${targets.length===1?'the destination crystal':'all destination crystals'} · level ${stage+1} forming`);if(!transitioning){transitioning=true;targets.forEach(wave);if(!final)later(()=>buildLevel(stage+1),1500);}}else status(`Celestial Circuit · level ${stage} of ${levels.length}`,`${powered.size} segments energized · route the core to ${targets.length===1?'the gold crystal':`all ${targets.length} gold crystals`}`);}
        function pick(index){if(transitioning||!current[index])return;current[index]=rotate(current[index]);render();}buildLevel(1);return{destroy:()=>board.destroy()};
      },
    };
    function onClick(event) { const box=image.getBoundingClientRect(),x=(event.clientX-box.left)*1672/box.width,y=(event.clientY-box.top)*941/box.height;if(x>=435&&x<=565&&y>=807&&y<=941)move(-1);else if(x>=1080&&x<=1218&&y>=807&&y<=941)move(1);else if(x>=610&&x<=1035&&y>=785&&y<=941)select(); }
    target.addEventListener('click',onClick);showMenu();
    return{previous:()=>move(-1),next:()=>move(1),select,selected:()=>catalog[selection],catalog:()=>catalog.map(g=>({...g})),destroy(){destroyed=true;stop();clearTimeout(menuTimer);target.removeEventListener('click',onClick);}};
  }
  globalThis.FutureGameCarousel=Object.freeze({mount,catalog:catalog.map(g=>({...g})),geometry:Object.freeze({corners,inset,perspectiveInset,treasurePath})});
})();
