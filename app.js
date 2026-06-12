let historyData = null;
let chartData = null;
let timelineData = null;

function initReveal() {
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) entry.target.classList.add('show');
    });
  }, { threshold: 0.12 });
  document.querySelectorAll('.reveal').forEach(el => observer.observe(el));
}

function initOverview() {
  const cards = [...document.querySelectorAll('.period-card')];
  const points = [...document.querySelectorAll('.point, .event-marker')];

  function activate(id) {
    cards.forEach(card => card.classList.toggle('active', card.id === id));
    points.forEach(point => point.classList.toggle('active', point.dataset.card === id));
  }

  function go(target) {
    const era = document.querySelector(`.era[data-year="${target}"]`);
    if (era) era.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  cards.forEach(card => {
    card.addEventListener('click', () => {
      activate(card.id);
      go(card.dataset.target);
    });
  });

  points.forEach(point => {
    point.addEventListener('click', () => {
      activate(point.dataset.card);
      go(point.dataset.target);
    });
  });
}

async function loadChartJson() {
  const url = `data/lazio-chart.json?ts=${Date.now()}`;
  const response = await fetch(url, { cache: 'no-store' });

  if (!response.ok) {
    throw new Error(`Impossibile leggere ${url}: HTTP ${response.status}`);
  }

  const data = await response.json();

  if (!data.bands || !Array.isArray(data.bands)) {
    throw new Error('Il JSON del grafico deve contenere un array "bands".');
  }

  if (!data.points || !Array.isArray(data.points)) {
    throw new Error('Il JSON del grafico deve contenere un array "points".');
  }

  return data;
}

function getSeasonYear(point) {
  const match = String(point.season || point.label || '').match(/\d{4}/);
  return match ? Number(match[0]) : null;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function renderRuns(runs) {
  return (runs || []).map(run => {
    const text = escapeHtml(run.text || '');
    return run.strong ? `<strong>${text}</strong>` : text;
  }).join('');
}

function buildCurvePath(points) {
  if (!points.length) return '';

  const command = [`M${points[0].x} ${points[0].y}`];

  for (let index = 0; index < points.length - 1; index += 1) {
    const p0 = points[index - 1] || points[index];
    const p1 = points[index];
    const p2 = points[index + 1];
    const p3 = points[index + 2] || p2;
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;

    command.push(`C${cp1x.toFixed(1)} ${cp1y.toFixed(1)},${cp2x.toFixed(1)} ${cp2y.toFixed(1)},${p2.x} ${p2.y}`);
  }

  return command.join(' ');
}

function tooltipText(point) {
  const meta = [point.league, point.positionLabel || (point.position ? `${point.position}° posto` : '')]
    .filter(Boolean)
    .join(' · ');
  return [point.season, meta, point.note].filter(Boolean).join('\n');
}

function presidentTooltipText(president) {
  const end = president.endLabel || president.endYear || '';
  return [president.name, `${president.startYear}-${end}`, president.note].filter(Boolean).join('\n');
}

function ensureChartTooltip() {
  let tooltip = document.querySelector('#chartTooltip');

  if (!tooltip) {
    tooltip = document.createElement('div');
    tooltip.id = 'chartTooltip';
    tooltip.className = 'chart-tooltip';
    tooltip.hidden = true;
    document.body.appendChild(tooltip);
  }

  return tooltip;
}

function initChartTooltip(svg) {
  const tooltip = ensureChartTooltip();

  function hide() {
    tooltip.hidden = true;
  }

  function show(target, clientX, clientY) {
    const title = target.dataset.tooltipTitle || '';
    const meta = target.dataset.tooltipMeta || '';
    const note = target.dataset.tooltipNote || '';

    tooltip.innerHTML = `
      <strong>${escapeHtml(title)}</strong>
      <span>${escapeHtml(meta)}</span>
      ${note ? `<p>${escapeHtml(note)}</p>` : ''}
    `;
    tooltip.hidden = false;

    const margin = 16;
    const x = Math.min(clientX + 14, window.innerWidth - tooltip.offsetWidth - margin);
    const y = Math.min(clientY + 14, window.innerHeight - tooltip.offsetHeight - margin);
    tooltip.style.left = `${Math.max(margin, x)}px`;
    tooltip.style.top = `${Math.max(margin, y)}px`;
  }

  svg.addEventListener('pointermove', event => {
    const target = event.target.closest('[data-tooltip-title]');
    if (!target) {
      hide();
      return;
    }
    show(target, event.clientX, event.clientY);
  });

  svg.addEventListener('pointerleave', hide);

  svg.addEventListener('focusin', event => {
    const target = event.target.closest('[data-tooltip-title]');
    if (!target) return;
    const rect = target.getBoundingClientRect();
    show(target, rect.left + rect.width / 2, rect.top + rect.height / 2);
  });

  svg.addEventListener('focusout', hide);
}

function renderOverviewChart(data) {
  const svg = document.querySelector('#overviewChart');
  if (!svg) return;

  const width = 1200;
  const height = 482;
  const left = 76;
  const right = 38;
  const baseline = 392;
  const bandByLeague = new Map(data.bands.map(band => [band.league, band]));
  const positionToY = (band, position) => {
    const maxPosition = Number(band.maxPosition || 20);
    const safePosition = Math.min(Math.max(Number(position || maxPosition), 1), maxPosition);
    const positionRatio = maxPosition <= 1 ? 0 : (safePosition - 1) / (maxPosition - 1);

    return Number(band.yTop) + positionRatio * (Number(band.yBottom) - Number(band.yTop));
  };
  const sourcePoints = data.points
    .map(point => ({ ...point, year: getSeasonYear(point) }))
    .filter(point => point.year && bandByLeague.has(point.league));
  const sourceEvents = (data.events || [])
    .map(event => ({ ...event, year: getSeasonYear(event) }))
    .filter(event => event.year);

  if (!sourcePoints.length) {
    throw new Error('Il JSON del grafico non contiene punti validi.');
  }

  const timelineStart = Number(data.timeline && data.timeline.startYear) || 1900;
  const timelineEnd = Number(data.timeline && data.timeline.endYear) || Math.max(...sourcePoints.map(point => point.year));
  const allYears = [...sourcePoints, ...sourceEvents].map(item => item.year);
  const minYear = Math.min(...allYears, timelineStart);
  const maxYear = Math.max(...allYears, timelineEnd);
  const yearToX = year => {
    const yearRatio = maxYear === minYear ? 0 : (year - minYear) / (maxYear - minYear);
    return Math.round(left + yearRatio * (width - left - right));
  };
  const chartPoints = sourcePoints.map(point => {
    const band = bandByLeague.get(point.league);

    return {
      ...point,
      x: yearToX(point.year),
      y: Math.round(positionToY(band, point.position))
    };
  });
  const curvePath = buildCurvePath(chartPoints);
  const firstPoint = chartPoints[0];
  const lastPoint = chartPoints[chartPoints.length - 1];
  const fillPath = `${curvePath} L${lastPoint.x} ${baseline} L${firstPoint.x} ${baseline} Z`;
  const gradientStops = (data.gradient || []).map(stop => (
    `<stop offset="${escapeHtml(stop.offset)}" stop-color="${escapeHtml(stop.color)}"/>`
  )).join('');
  const grid = data.bands.map(band => {
    const yTop = Number(band.yTop);
    const yBottom = Number(band.yBottom);
    const yMiddle = Math.round((yTop + yBottom) / 2);
    const maxPosition = Number(band.maxPosition || 20);
    const zones = (band.zones || []).map(zone => {
      const zoneTopPosition = Number(zone.fromPosition) <= 1
        ? 1
        : Number(zone.fromPosition) - 0.5;
      const zoneBottomPosition = Number(zone.toPosition) >= maxPosition
        ? maxPosition
        : Number(zone.toPosition) + 0.5;
      const zoneTop = Math.round(positionToY(band, zoneTopPosition));
      const zoneBottom = Math.round(positionToY(band, zoneBottomPosition));
      const zoneHeight = Math.max(zoneBottom - zoneTop, 1);

      return `
        <rect x="${left}" y="${zoneTop}" width="${width - left - right}" height="${zoneHeight}" class="table-zone ${escapeHtml(zone.className)}"/>
        <text x="${width - right - 18}" y="${zoneTop + 24}" class="zone-label">${escapeHtml(zone.label)}</text>
      `;
    }).join('');

    return `
      <rect x="${left - 8}" y="${yTop - 10}" width="${width - left - right + 16}" height="${yBottom - yTop + 20}" class="league-band"/>
      ${zones}
      <line x1="${left}" y1="${yMiddle}" x2="${width - right}" y2="${yMiddle}" class="midline"/>
      <line x1="${left}" y1="${yTop}" x2="${width - right}" y2="${yTop}" class="gridline strong"/>
      <line x1="${left}" y1="${yBottom}" x2="${width - right}" y2="${yBottom}" class="gridline"/>
      <text x="34" y="${yMiddle}" class="league-label" transform="rotate(-90 34 ${yMiddle})">${escapeHtml(band.label)}</text>
    `;
  }).join('');
  const separator = data.bands.length > 1
    ? data.bands.slice(0, -1).map((band, index) => {
      const nextBand = data.bands[index + 1];
      const y = Math.round((Number(band.yBottom) + Number(nextBand.yTop)) / 2);

      return `<line x1="${left - 8}" y1="${y}" x2="${width - right + 8}" y2="${y}" class="league-separator"/>`;
    }).join('')
    : '';
  const tickStart = Math.ceil(minYear / 10) * 10;
  const yearTicks = [];
  for (let year = tickStart; year <= maxYear; year += 10) {
    const x = yearToX(year);
    yearTicks.push(`
      <line x1="${x}" y1="448" x2="${x}" y2="456" class="x-tick"/>
      <text x="${x}" y="476" class="x-tick-label">${year}</text>
    `);
  }
  const eventY = data.bands.length > 1
    ? Math.round((Number(data.bands[0].yBottom) + Number(data.bands[1].yTop)) / 2)
    : baseline - 26;
  const events = sourceEvents.map(event => {
    const x = yearToX(event.year);
    const meta = [event.league, event.positionLabel].filter(Boolean).join(' · ');

    return `
      <g class="event-marker" tabindex="0" data-card="${escapeHtml(event.card)}" data-target="${escapeHtml(event.target)}" data-tooltip-title="${escapeHtml(event.season)}" data-tooltip-meta="${escapeHtml(meta)}" data-tooltip-note="${escapeHtml(event.note)}">
        <title>${escapeHtml(tooltipText(event))}</title>
        <line x1="${x}" y1="${eventY - 18}" x2="${x}" y2="${eventY + 18}"></line>
        <circle cx="${x}" cy="${eventY}" r="7"></circle>
      </g>
    `;
  }).join('');
  const presidentStripY = 407;
  const presidentStripHeight = 28;
  const presidentLabels = data.presidents && data.presidents.length
    ? `
      <text x="${left}" y="${presidentStripY - 8}" class="president-axis-label">Presidenti</text>
      <line x1="${left}" y1="${presidentStripY + presidentStripHeight / 2}" x2="${width - right}" y2="${presidentStripY + presidentStripHeight / 2}" class="president-track"/>
      <line x1="${left}" y1="${presidentStripY + presidentStripHeight + 8}" x2="${width - right}" y2="${presidentStripY + presidentStripHeight + 8}" class="president-baseline"/>
    `
    : '';
  const presidents = (data.presidents || []).map((president, index) => {
    const startYear = Math.max(Number(president.startYear), minYear);
    const endYear = Math.min(Number(president.endYear || maxYear), maxYear);
    const meta = `${president.startYear}-${president.endLabel || president.endYear || ''}`;
    const isDot = president.display === 'dot' || (endYear - startYear) < 4;

    if (isDot) {
      const x = yearToX((startYear + endYear) / 2);

      return `
        <g class="president-dot president-${index % 3}" tabindex="0" data-tooltip-title="${escapeHtml(president.name)}" data-tooltip-meta="${escapeHtml(meta)}" data-tooltip-note="${escapeHtml(president.note)}">
          <title>${escapeHtml(presidentTooltipText(president))}</title>
          <circle cx="${x}" cy="${presidentStripY + presidentStripHeight / 2}" r="5"></circle>
        </g>
      `;
    }

    const x = yearToX(startYear);
    const x2 = yearToX(endYear);
    const barWidth = Math.max(x2 - x, 8);
    const label = barWidth > 78 ? president.name : president.name.split(' ').pop();

    return `
      <g class="president-band president-${index % 3}" tabindex="0" data-tooltip-title="${escapeHtml(president.name)}" data-tooltip-meta="${escapeHtml(meta)}" data-tooltip-note="${escapeHtml(president.note)}">
        <title>${escapeHtml(presidentTooltipText(president))}</title>
        <rect x="${x}" y="${presidentStripY}" width="${barWidth}" height="${presidentStripHeight}" rx="8"></rect>
        <text x="${x + Math.min(barWidth / 2, Math.max(34, barWidth - 8))}" y="${presidentStripY + 19}">${escapeHtml(label)}</text>
      </g>
    `;
  }).join('');
  let linkedLabelIndex = 0;
  const points = chartPoints.map(point => {
    const linkedLabelY = point.showLabel ? (linkedLabelIndex % 2 === 0 ? 24 : 44) : null;
    if (point.showLabel) linkedLabelIndex += 1;

    return `
    <g class="point ${escapeHtml(point.status || 'stable')} ${point.note ? 'has-note' : ''}" tabindex="0" data-card="${escapeHtml(point.card)}" data-target="${escapeHtml(point.target)}" data-tooltip-title="${escapeHtml(point.season)}" data-tooltip-meta="${escapeHtml([point.league, point.positionLabel].filter(Boolean).join(' · '))}" data-tooltip-note="${escapeHtml(point.note)}">
      <title>${escapeHtml(tooltipText(point))}</title>
      <circle cx="${point.x}" cy="${point.y}" r="3"></circle>
      ${point.showLabel ? `<text x="${point.x}" y="${linkedLabelY}" class="linked-year-label">${escapeHtml(point.label)}</text>` : ''}
    </g>
  `;
  }).join('');

  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.innerHTML = `
    <defs>
      <linearGradient id="curveGradient" x1="0" x2="1">${gradientStops}</linearGradient>
      <filter id="glow"><feGaussianBlur stdDeviation="2.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    </defs>
    ${grid}
    ${separator}
    ${yearTicks.join('')}
    <path class="curve-fill" d="${fillPath}"></path>
    <path class="curve-line" d="${curvePath}"></path>
    ${events}
    ${points}
    ${presidentLabels}
    ${presidents}
  `;
  initChartTooltip(svg);
}

function showOverviewError(message) {
  const svg = document.querySelector('#overviewChart');
  if (!svg) return;

  svg.innerHTML = `
    <text x="92" y="210" class="axis-label">Errore caricamento data/lazio-chart.json</text>
    <text x="92" y="244" class="axis-label">${escapeHtml(message)}</text>
  `;
}

async function loadHistoryJson() {
  const url = `data/lazio-history.json?ts=${Date.now()}`;
  const response = await fetch(url, { cache: 'no-store' });

  if (!response.ok) {
    throw new Error(`Impossibile leggere ${url}: HTTP ${response.status}`);
  }

  const data = await response.json();

  if (!data.players || !Array.isArray(data.players)) {
    throw new Error('Il JSON deve contenere un array "players".');
  }

  return data;
}

function renderPlayers(data) {
  const grid = document.querySelector('#playersGrid');
  if (!grid) return;

  grid.innerHTML = data.players.map(player => `
    <article class="player-card reveal" data-player-id="${player.id}">
      <div class="player-card-bg" style="background-image:url('${player.image}')"></div>
      <div class="player-card-content">
        <p class="era-label">${player.role || ''}</p>
        <h3>${player.name || ''}</h3>
        <p>${player.period || ''}</p>
        <button class="mini-button" type="button">Apri scheda</button>
      </div>
    </article>
  `).join('');

  grid.querySelectorAll('[data-player-id]').forEach(card => {
    card.addEventListener('click', () => openPlayer(card.dataset.playerId));
  });

  initReveal();
}

function showPlayersError(message) {
  const grid = document.querySelector('#playersGrid');
  if (!grid) return;
  grid.innerHTML = `
    <div class="json-error-card">
      <strong>Errore caricamento JSON</strong>
      <p>${message}</p>
      <p>Controlla che <code>data/lazio-history.json</code> esista, sia valido e che tu stia avviando il server dalla cartella giusta.</p>
    </div>
  `;
}

async function loadTimelineJson() {
  const url = `data/timeline.json?ts=${Date.now()}`;
  const response = await fetch(url, { cache: 'no-store' });

  if (!response.ok) {
    throw new Error(`Impossibile leggere ${url}: HTTP ${response.status}`);
  }

  const data = await response.json();

  if (!data.items || !Array.isArray(data.items)) {
    throw new Error('Il JSON della timeline deve contenere un array "items".');
  }

  return data;
}

function renderTimeline(data) {
  const title = document.querySelector('#timelineTitle');
  const intro = document.querySelector('#timelineHead p:last-child');
  const list = document.querySelector('#timelineList');
  if (!list) return;

  if (title) title.innerHTML = renderRuns(data.titleRuns);
  if (intro) intro.innerHTML = renderRuns(data.introRuns);

  let eventIndex = 0;

  list.innerHTML = data.items.map(item => {
    if (item.type === 'chapter') {
      return `
        <article class="era timeline-chapter reveal" data-year="${escapeHtml(item.period)}">
          <div class="era-year">${escapeHtml(item.period)}</div>
          <div class="era-card chapter-card">
            <p class="era-label">Capitolo</p>
            <h3>${escapeHtml(item.title)}</h3>
            ${item.bodyRuns && item.bodyRuns.length ? `<p>${renderRuns(item.bodyRuns)}</p>` : ''}
          </div>
        </article>
      `;
    }

    if (item.type === 'closing') {
      return `
        <article class="era timeline-closing reveal" data-year="oggi">
          <div class="era-year">${escapeHtml(item.period)}</div>
          <div class="era-card present">
            <p class="era-label">Sintesi</p>
            <h3>${escapeHtml(item.title)}</h3>
            <p>${renderRuns(item.bodyRuns)}</p>
          </div>
        </article>
      `;
    }

    const sideClass = eventIndex % 2 === 0 ? 'timeline-right-card' : 'timeline-left-card';
    eventIndex += 1;

    return `
      <article class="era ${sideClass} reveal" data-year="${escapeHtml(item.year)}">
        <div class="era-year">${escapeHtml(item.year)}</div>
        <div class="era-card ${escapeHtml(item.className || 'origin')}">
          <p class="era-label">${escapeHtml(item.label || 'Timeline')}</p>
          <h3>${escapeHtml(item.title)}</h3>
          <p>${renderRuns(item.bodyRuns)}</p>
        </div>
      </article>
    `;
  }).join('');

  initReveal();
}

function showTimelineError(message) {
  const list = document.querySelector('#timelineList');
  if (!list) return;

  list.innerHTML = `
    <article class="era reveal" data-year="Errore">
      <div class="era-year">Errore</div>
      <div class="era-card rescue">
        <p class="era-label">Timeline</p>
        <h3>Errore caricamento data/timeline.json</h3>
        <p>${escapeHtml(message)}</p>
      </div>
    </article>
  `;
}

async function openPlayer(id) {
  const overlay = document.querySelector('#playerOverlay');
  if (!overlay) return;

  let data;
  try {
    // Lettura runtime reale: ogni apertura della scheda rilegge il JSON.
    data = await loadHistoryJson();
    historyData = data;
  } catch (error) {
    showPlayersError(error.message);
    alert(`Errore nel caricamento di data/lazio-history.json: ${error.message}`);
    return;
  }

  const player = data.players.find(item => item.id === id);
  if (!player) {
    alert(`Giocatore non trovato nel JSON: ${id}`);
    return;
  }

  const sheet = overlay.querySelector('.player-sheet');
  sheet.style.setProperty('--player-photo', `url('${player.image}')`);
  overlay.querySelector('.player-role').textContent = (player.role || '').toUpperCase();
  overlay.querySelector('.player-name').innerHTML = (player.name || '').replace(' ', '<br>');
  overlay.querySelector('.player-description').textContent = player.description || '';
  overlay.querySelector('.player-stats').innerHTML = (player.stats || []).map(stat => `
    <div class="player-stat">
      <strong>${stat.value || ''}</strong>
      <span>${stat.label || ''}</span>
      <em>${stat.icon || ''}</em>
    </div>
  `).join('');

  overlay.hidden = false;
  overlay.classList.remove('hologram-on');
  document.body.classList.add('modal-open');
}

function closePlayer() {
  const overlay = document.querySelector('#playerOverlay');
  if (!overlay) return;
  overlay.hidden = true;
  document.body.classList.remove('modal-open');
}

function initPlayer() {
  const overlay = document.querySelector('#playerOverlay');
  if (!overlay) return;

  overlay.querySelector('.player-close').addEventListener('click', closePlayer);

  overlay.addEventListener('click', event => {
    if (event.target === overlay || event.target.classList.contains('player-sheet-shell')) {
      closePlayer();
    }
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !overlay.hidden) closePlayer();
  });

  overlay.querySelector('.hologram-trigger').addEventListener('click', () => {
    overlay.classList.toggle('hologram-on');
  });

  overlay.querySelector('.data-trigger').addEventListener('click', () => {
    overlay.querySelector('.player-stats').animate([
      { transform: 'translateY(0)', filter: 'brightness(1)' },
      { transform: 'translateY(-8px)', filter: 'brightness(1.18)' },
      { transform: 'translateY(0)', filter: 'brightness(1)' }
    ], { duration: 650, easing: 'ease-out' });
  });
}

async function loadData() {
  try {
    historyData = await loadHistoryJson();
    renderPlayers(historyData);
  } catch (error) {
    console.error(error);
    showPlayersError(error.message);
  }
}

async function loadTimeline() {
  try {
    timelineData = await loadTimelineJson();
    renderTimeline(timelineData);
  } catch (error) {
    console.error(error);
    showTimelineError(error.message);
  }
}

async function loadOverview() {
  try {
    chartData = await loadChartJson();
    renderOverviewChart(chartData);
  } catch (error) {
    console.error(error);
    showOverviewError(error.message);
  } finally {
    initOverview();
  }
}

initReveal();
initPlayer();
loadTimeline();
loadOverview();
loadData();
