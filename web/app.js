/* Atlas front end. Expects window.ATLAS_DATA (built by scripts/bundle.py), d3 and topojson. */
(function () {
  "use strict";
  const D = window.ATLAS_DATA;
  const STATE_ID = Object.keys(D.geo).find((k) => k.length === 2);
  const S0 = D.geo[STATE_ID];
  const META = D.meta;

  // ---------- geometry ----------
  const stateFeat = topojson.feature(D.topo, D.topo.objects.state).features[0];
  const counties = topojson.feature(D.topo, D.topo.objects.counties).features;
  const tracts = topojson.feature(D.topo, D.topo.objects.tracts).features;
  const countyMesh = topojson.mesh(D.topo, D.topo.objects.counties, (a, b) => a !== b);
  const byId = new Map();
  counties.forEach((f) => { f.properties.level = "county"; byId.set(f.properties.GEOID, f); });
  tracts.forEach((f) => { f.properties.level = "tract"; byId.set(f.properties.GEOID, f); });
  stateFeat.properties.level = "state";
  stateFeat.properties.name = D.name;
  byId.set(STATE_ID, stateFeat);

  // derived: population density (people per square mile of land)
  const SQMI = 2589988.11;
  let landTotal = 0;
  counties.forEach((f) => (landTotal += +f.properties.aland));
  [...counties, ...tracts].forEach((f) => {
    const s = D.geo[f.properties.GEOID];
    if (!s) return;
    s.m.pop = s.pop;
    s.m.density = f.properties.aland > 0 ? s.pop / (f.properties.aland / SQMI) : null;
  });
  S0.m.pop = S0.pop;
  S0.m.density = S0.pop / (landTotal / SQMI);

  // ---------- formatting ----------
  const fInt = d3.format(",");
  const fPct = (v) => v.toFixed(1) + "%";
  const fMoney = d3.format("$,.0f");
  const fK = (v) => (v >= 1000 ? "$" + Math.round(v / 1000) + "k" : "$" + Math.round(v));
  const fDens = (v) => (v < 10 ? v.toFixed(1) : fInt(Math.round(v)));
  const short = { pct: (v) => Math.round(v) + "%" };

  // ---------- metric catalogue ----------
  const RACE_KEYS = ["pct_white", "pct_black", "pct_hispanic", "pct_asian", "pct_native", "pct_multi"];
  const TOPICS = [
    { id: "pop", label: "Population", metrics: [
      { id: "density", label: "Population density", unit: "people per square mile", fmt: fDens, tick: (v) => fInt(Math.round(v)) },
      { id: "pop", label: "Total population", unit: "residents", fmt: fInt, tick: (v) => d3.format(".2~s")(v) },
    ]},
    { id: "race", label: "Race & Ethnicity", metrics: [
      { id: "predominant", label: "Largest group", type: "cat", unit: "largest racial or ethnic group" },
      { id: "pct_white", label: "White", unit: "% non-Hispanic White", fmt: fPct, tick: short.pct },
      { id: "pct_black", label: "Black", unit: "% non-Hispanic Black", fmt: fPct, tick: short.pct },
      { id: "pct_hispanic", label: "Hispanic", unit: "% Hispanic or Latino, any race", fmt: fPct, tick: short.pct },
      { id: "pct_asian", label: "Asian", unit: "% non-Hispanic Asian", fmt: fPct, tick: short.pct },
      { id: "pct_native", label: "Native American", unit: "% non-Hispanic American Indian / Alaska Native", fmt: fPct, tick: short.pct },
      { id: "pct_multi", label: "Multiracial / Other", unit: "% two or more races, Pacific Islander or other", fmt: fPct, tick: short.pct },
      { id: "diversity", label: "Diversity index", unit: "chance two random residents are of different groups", fmt: (v) => Math.round(v) + "%", tick: short.pct },
    ]},
    { id: "age", label: "Age & Sex", metrics: [
      { id: "median_age", label: "Median age", unit: "years", fmt: (v) => v.toFixed(1), tick: (v) => Math.round(v), moe: true },
      { id: "pct_under18", label: "Under 18", unit: "% of residents under 18", fmt: fPct, tick: short.pct },
      { id: "pct_65plus", label: "65 and older", unit: "% of residents 65+", fmt: fPct, tick: short.pct },
      { id: "sex_ratio", label: "Sex ratio", type: "div", unit: "men per 100 women", fmt: (v) => v.toFixed(1), tick: (v) => Math.round(v),
        thresholds: [85, 93, 98, 102, 107, 115] },
    ]},
    { id: "edu", label: "Education", metrics: [
      { id: "pct_ba_plus", label: "Bachelor's or higher", unit: "% of adults 25+", fmt: fPct, tick: short.pct },
      { id: "pct_hs_plus", label: "High school or higher", unit: "% of adults 25+", fmt: fPct, tick: short.pct },
      { id: "pct_grad", label: "Graduate degree", unit: "% of adults 25+", fmt: fPct, tick: short.pct },
    ]},
    { id: "inc", label: "Income & Inequality", metrics: [
      { id: "median_income", label: "Median household income", unit: "dollars, 2023-adjusted", fmt: fMoney, tick: fK, moe: true },
      { id: "poverty", label: "Poverty rate", unit: "% of residents below the poverty line", fmt: fPct, tick: short.pct },
      { id: "gini", label: "Gini index", unit: "income inequality, 0 = equal, 1 = one household has all", fmt: (v) => v.toFixed(3), tick: (v) => v.toFixed(2), moe: true },
    ]},
  ];
  const METRIC = {};
  TOPICS.forEach((t) => t.metrics.forEach((m) => (METRIC[m.id] = Object.assign(m, { topic: t.id }))));

  // ---------- palettes (dataviz reference palette) ----------
  // Sequential: near-white (lowest) -> the chart blue #0f5499 (highest).
  const SEQ = ["#f8fafc", "#d4e0ed", "#adc5dc", "#87aacc", "#618ebc", "#3871aa", "#0f5499"];
  const SEQ_DARK = SEQ;
  // Diverging (sex ratio): blue = more women, red = more men, neutral midpoint.
  const DIV = ["#0f5499", "#4f88c6", "#a9c9e8", "#f2e6dc", "#f7ae8f", "#d9503f", "#7a0a24"];
  const DIV_DARK = ["#3f7fc4", "#2d5a8c", "#24384f", "#3a3f4a", "#6b2a2e", "#c0413a", "#f08c75"];
  // Categorical (largest group)
  const CAT = ["#0f5499", "#990f3d", "#0d7680", "#e3a000", "#eb5e8d", "#593380"];
  const CAT_DARK = ["#6baef0", "#f2779d", "#2ea6ae", "#f0b429", "#f59fbf", "#a98bd6"];
  const root = document.documentElement;
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const isDark = () => false; // the atlas always uses its light salmon look
  const pal = () => (isDark() ? { seq: SEQ_DARK, div: DIV_DARK, cat: CAT_DARK } : { seq: SEQ, div: DIV, cat: CAT });

  // ---------- state ----------
  const st = { topic: "inc", metric: "median_income", level: "county", focus: null, selected: STATE_ID, view: "map", sort: { key: "value", dir: -1 } };

  // ---------- DOM ----------
  const $ = (s) => document.querySelector(s);
  const topicsEl = $("#topics"), metricsEl = $("#metrics"), crumbsEl = $("#crumbs");
  const mapbox = $("#mapbox"), tablebox = $("#tablebox"), legendEl = $("#legend"), panel = $("#panel"), tip = $("#tip");
  document.title = D.name + " Atlas";
  $("#title").innerHTML = D.name + " <span>Atlas</span>";
  $("#source").textContent = "American Community Survey, " + D.source.replace("ACS 5-year estimates, ", "") + " 5-year estimates · U.S. Census Bureau";

  // ---------- map ----------
  const svg = d3.select("#map");
  const gZoom = svg.append("g");
  const gCounty = gZoom.append("g");
  const gTract = gZoom.append("g");
  const meshPath = gZoom.append("path").attr("class", "mesh");
  const outlinePath = gZoom.append("path").attr("class", "outline");
  const selHalo = gZoom.append("path").attr("class", "sel-halo");
  const selPath = gZoom.append("path").attr("class", "sel");
  let projection, geoPath, W = 0, H = 0;
  const zoom = d3.zoom().scaleExtent([1, 60]).on("zoom", (e) => gZoom.attr("transform", e.transform));
  svg.call(zoom).on("dblclick.zoom", null);

  const countySel = gCounty.selectAll("path").data(counties).join("path").attr("class", "unit");
  const tractSel = gTract.selectAll("path").data(tracts).join("path").attr("class", "unit");

  function layout() {
    const r = mapbox.getBoundingClientRect();
    W = Math.max(r.width, 200); H = Math.max(r.height, 200);
    svg.attr("viewBox", [0, 0, W, H]);
    const c = d3.geoCentroid(stateFeat);
    projection = d3.geoConicConformal().rotate([-c[0], 0]).parallels([c[1] - 2, c[1] + 2])
      .fitExtent([[16, 16], [W - 16, H - 16]], stateFeat);
    geoPath = d3.geoPath(projection);
    countySel.attr("d", geoPath);
    tractSel.attr("d", geoPath);
    meshPath.attr("d", geoPath(countyMesh));
    outlinePath.attr("d", geoPath(stateFeat));
    drawSelection();
    zoomToCurrent(false);
  }

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  function zoomToFeature(f, animate) {
    let t = d3.zoomIdentity;
    if (f && f !== stateFeat) {
      const [[x0, y0], [x1, y1]] = geoPath.bounds(f);
      const k = Math.min(40, 0.85 / Math.max((x1 - x0) / W, (y1 - y0) / H));
      t = d3.zoomIdentity.translate(W / 2, H / 2).scale(k).translate(-(x0 + x1) / 2, -(y0 + y1) / 2);
    }
    (animate && !reduceMotion ? svg.transition().duration(750) : svg).call(zoom.transform, t);
  }
  function zoomToCurrent(animate) { zoomToFeature(st.focus ? byId.get(st.focus) : null, animate); }

  // ---------- classification ----------
  const val = (id) => { const s = D.geo[id]; return s ? s.m[st.metric] : null; };
  const has = (v) => v !== null && v !== undefined && !Number.isNaN(v);
  function refUnits() { return st.level === "county" && !st.focus ? counties : tracts; }
  function visibleUnits() {
    if (st.level === "county" && !st.focus) return counties;
    if (st.focus) return tracts.filter((f) => f.properties.GEOID.startsWith(st.focus));
    return tracts;
  }
  function niceRound(v, m) {
    if (m.id === "median_income") return Math.round(v / 1000) * 1000;
    if (m.id === "gini") return Math.round(v * 100) / 100;
    if (m.id === "density" || m.id === "pop") { const p = Math.pow(10, Math.max(0, Math.floor(Math.log10(Math.abs(v) || 1)) - 1)); return Math.round(v / p) * p; }
    return v >= 10 ? Math.round(v) : Math.round(v * 10) / 10;
  }
  let scale = null;
  function buildScale() {
    const m = METRIC[st.metric], P = pal();
    if (m.type === "cat") {
      const present = new Set(refUnits().map((f) => val(f.properties.GEOID)).filter(has));
      scale = { type: "cat", color: (v) => P.cat[v], present: [...present].sort() };
      return;
    }
    let th;
    if (m.type === "div") th = m.thresholds;
    else {
      const vals = refUnits().map((f) => val(f.properties.GEOID)).filter(has);
      th = d3.scaleQuantile().domain(vals).range(d3.range(7)).quantiles().map((v) => niceRound(v, m));
      th = th.filter((v, i) => i === 0 || v > th[i - 1]);
    }
    const colors = m.type === "div" ? P.div : P.seq;
    const used = colors.length === th.length + 1 ? colors : d3.quantize(d3.interpolateRgbBasis(colors), th.length + 1);
    scale = { type: "num", th, colors: used, color: (v) => used[d3.bisectRight(th, v)] };
  }
  const fillOf = (f) => { const v = val(f.properties.GEOID); return has(v) ? scale.color(v) : "var(--nodata)"; };

  function paint() {
    buildScale();
    const tractMode = st.level === "tract" || st.focus;
    countySel.attr("fill", fillOf).classed("dim", !!st.focus).style("display", tractMode && !st.focus ? "none" : null)
      .style("pointer-events", st.focus ? "all" : null);
    tractSel.attr("fill", fillOf).style("display", (f) => {
      if (!tractMode) return "none";
      return st.focus && !f.properties.GEOID.startsWith(st.focus) ? "none" : null;
    });
    meshPath.style("display", null);
    drawLegend();
    if (st.view === "table") drawTable();
  }

  function drawSelection() {
    const f = st.selected !== STATE_ID ? byId.get(st.selected) : null;
    const d = f ? geoPath(f) : null;
    selPath.attr("d", d); selHalo.attr("d", d);
  }

  // ---------- legend ----------
  function drawLegend() {
    const m = METRIC[st.metric];
    const where = st.level === "county" && !st.focus ? "counties" : "census tracts";
    let h = `<div class="ltitle"><b>${m.label}</b>${m.unit} · ${m.type === "cat" ? "" : m.type === "div" ? "fixed breaks" : "7 equal-count groups of " + where}</div>`;
    if (scale.type === "cat") {
      h += `<div class="catlegend">${scale.present.map((i) => `<span><i style="background:${pal().cat[i]}"></i>${META.race[i]}</span>`).join("")}</div>`;
    } else {
      const n = scale.colors.length, w = 46, gap = 2;
      h += `<div class="scale"><div class="swatches">${scale.colors.map((c) => `<i style="background:${c}"></i>`).join("")}</div>
        <div class="ticks" style="width:${n * w + (n - 1) * gap}px">${scale.th.map((t, i) => `<span style="left:${(i + 1) * (w + gap) - gap / 2}px">${m.tick(t)}</span>`).join("")}</div></div>`;
    }
    h += `<span class="nd"><i></i>No data / no residents</span>`;
    legendEl.innerHTML = h;
    const sw = legendEl.querySelector(".swatches i");
    if (sw && sw.offsetWidth && sw.offsetWidth !== 46) {
      const w = sw.offsetWidth, gap = 2;
      legendEl.querySelector(".ticks").style.width = scale.colors.length * (w + gap) + "px";
      legendEl.querySelectorAll(".ticks span").forEach((s, i) => (s.style.left = (i + 1) * (w + gap) - gap / 2 + "px"));
    }
  }

  // ---------- tooltip ----------
  function fmtVal(id, mId) {
    const m = METRIC[mId || st.metric], s = D.geo[id];
    if (!s) return "No data";
    const v = s.m[m.id];
    if (!has(v)) return "No data";
    if (m.type === "cat") return META.race[v];
    let out = m.fmt(v);
    if (m.moe && s.moe[m.id] != null) out += ` <span class="tc">±${m.fmt(s.moe[m.id])}</span>`;
    return out;
  }
  function showTip(e, f) {
    const id = f.properties.GEOID, s = D.geo[id];
    const sub = f.properties.level === "tract" ? f.properties.county : "";
    tip.innerHTML = `<div class="tn">${f.properties.name}</div>${sub ? `<div class="tc">${sub}</div>` : ""}
      <div class="tv"><span>${METRIC[st.metric].label}</span><b>${fmtVal(id)}</b></div>
      <div class="tv"><span>Population</span><b>${s ? fInt(s.pop) : "–"}</b></div>`;
    tip.hidden = false;
    const r = mapbox.getBoundingClientRect(), tw = tip.offsetWidth, th = tip.offsetHeight;
    let x = e.clientX - r.left + 14, y = e.clientY - r.top + 14;
    if (x + tw > r.width - 8) x = e.clientX - r.left - tw - 14;
    if (y + th > r.height - 8) y = e.clientY - r.top - th - 14;
    tip.style.left = Math.max(8, x) + "px"; tip.style.top = Math.max(8, y) + "px";
  }
  function hideTip() { tip.hidden = true; }
  [countySel, tractSel].forEach((sel) => sel.on("pointermove", (e, f) => { if (e.pointerType !== "touch") showTip(e, f); }).on("pointerleave", hideTip));

  // ---------- interaction ----------
  countySel.on("click", (e, f) => { hideTip(); focusCounty(f.properties.GEOID); });
  tractSel.on("click", (e, f) => { hideTip(); select(f.properties.GEOID); });

  function focusCounty(id) {
    st.focus = id; st.selected = id;
    update(true);
  }
  function select(id) {
    st.selected = id;
    if (id.length === 11 && st.focus && !id.startsWith(st.focus)) st.focus = null;
    update(false);
  }
  function goState() { st.focus = null; st.selected = STATE_ID; update(true); }
  function update(rezoom) {
    paint(); drawSelection(); drawCrumbs(); drawPanel(); syncControls();
    if (rezoom) zoomToCurrent(true);
  }
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (st.selected.length === 11 && st.focus) select(st.focus);
    else if (st.focus || st.selected !== STATE_ID) goState();
  });

  function drawCrumbs() {
    const parts = [{ id: STATE_ID, label: D.name }];
    const sel = st.selected;
    const cid = st.focus || (sel.length >= 5 ? sel.slice(0, 5) : null);
    if (cid) parts.push({ id: cid, label: byId.get(cid).properties.name, county: true });
    if (sel.length === 11) parts.push({ id: sel, label: byId.get(sel).properties.name });
    crumbsEl.innerHTML = parts.map((p, i) => i === parts.length - 1
      ? `<span class="here">${p.label}</span>`
      : `<button data-id="${p.id}" data-county="${p.county ? 1 : ""}">${p.label}</button><span class="sep">›</span>`).join("");
    crumbsEl.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
      if (b.dataset.id === STATE_ID) goState(); else focusCounty(b.dataset.id);
    }));
  }

  // ---------- controls ----------
  function drawTopics() {
    topicsEl.innerHTML = TOPICS.map((t) => `<button class="topic" role="tab" id="topic-${t.id}" data-t="${t.id}">${t.label}</button>`).join("");
    topicsEl.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
      const t = TOPICS.find((x) => x.id === b.dataset.t);
      st.topic = t.id; st.metric = t.metrics[0].id; drawMetrics(); update(false);
    }));
  }
  function drawMetrics() {
    const t = TOPICS.find((x) => x.id === st.topic);
    metricsEl.innerHTML = t.metrics.map((m) => `<button class="chip" id="metric-${m.id}" data-m="${m.id}">${m.label}</button>`).join("");
    metricsEl.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => { st.metric = b.dataset.m; update(false); }));
  }
  function syncControls() {
    topicsEl.querySelectorAll("button").forEach((b) => b.setAttribute("aria-selected", b.dataset.t === st.topic));
    metricsEl.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.m === st.metric));
    const lvl = st.focus ? "tract" : st.level;
    document.querySelectorAll("[data-level]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.level === lvl));
    document.querySelectorAll("[data-view]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.view === st.view));
  }
  document.querySelectorAll("[data-level]").forEach((b) => b.addEventListener("click", () => {
    st.level = b.dataset.level;
    if (st.focus) { st.focus = null; if (st.level === "county") st.selected = STATE_ID; update(true); }
    else update(false);
  }));
  document.querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => {
    st.view = b.dataset.view;
    mapbox.hidden = st.view !== "map"; tablebox.hidden = st.view !== "table";
    if (st.view === "map") layout();
    update(false);
  }));
  $("#zin").addEventListener("click", () => svg.transition().duration(300).call(zoom.scaleBy, 1.6));
  $("#zout").addEventListener("click", () => svg.transition().duration(300).call(zoom.scaleBy, 1 / 1.6));
  $("#zreset").addEventListener("click", () => zoomToCurrent(true));

  // ---------- table view ----------
  function drawTable() {
    const m = METRIC[st.metric];
    const units = visibleUnits();
    const showCounty = units === tracts;
    const rows = units.map((f) => {
      const s = D.geo[f.properties.GEOID];
      return { id: f.properties.GEOID, name: f.properties.name, county: f.properties.county || "", pop: s ? s.pop : null, value: s ? s.m[m.id] : null };
    });
    const { key, dir } = st.sort;
    rows.sort((a, b) => {
      const x = a[key], y = b[key];
      if (!has(x) && !has(y)) return 0; if (!has(x)) return 1; if (!has(y)) return -1;
      return (typeof x === "string" ? x.localeCompare(y) : x - y) * dir;
    });
    const arrow = (k) => (st.sort.key === k ? (st.sort.dir > 0 ? " ▲" : " ▼") : "");
    tablebox.innerHTML = `<table><thead><tr>
      <th data-k="name">Name${arrow("name")}</th>${showCounty ? `<th data-k="county">County${arrow("county")}</th>` : ""}
      <th class="num" data-k="pop">Population${arrow("pop")}</th><th class="num" data-k="value">${m.label}${arrow("value")}</th></tr></thead>
      <tbody>${rows.map((r) => `<tr data-id="${r.id}" class="${r.id === st.selected ? "on" : ""}"><td>${r.name}</td>${showCounty ? `<td>${r.county}</td>` : ""}
      <td class="num">${has(r.pop) ? fInt(r.pop) : "–"}</td><td class="num">${fmtVal(r.id)}</td></tr>`).join("")}</tbody></table>`;
    tablebox.querySelectorAll("th").forEach((th) => th.addEventListener("click", () => {
      const k = th.dataset.k;
      st.sort = { key: k, dir: st.sort.key === k ? -st.sort.dir : k === "name" || k === "county" ? 1 : -1 };
      drawTable();
    }));
    tablebox.querySelectorAll("tbody tr").forEach((tr) => tr.addEventListener("click", () => {
      const id = tr.dataset.id;
      if (id.length === 5 && !st.focus) focusCounty(id); else select(id);
    }));
  }

  // ---------- profile panel ----------
  const ctip = document.createElement("div");
  ctip.className = "tip"; ctip.hidden = true; ctip.style.position = "fixed";
  document.body.appendChild(ctip);
  function chartTip(sel, html) {
    sel.on("pointermove", (e, d) => {
      ctip.innerHTML = html(d); ctip.hidden = false;
      const tw = ctip.offsetWidth;
      let x = e.clientX + 12; if (x + tw > window.innerWidth - 8) x = e.clientX - tw - 12;
      ctip.style.left = x + "px"; ctip.style.top = e.clientY + 12 + "px";
    }).on("pointerleave", () => (ctip.hidden = true));
  }
  const shares = (arr) => { const t = d3.sum(arr); return arr.map((v) => (t ? (100 * v) / t : 0)); };

  // horizontal bars with an optional reference tick (the state value)
  function hbars(el, labels, counts, refCounts, color) {
    const sh = shares(counts), ref = refCounts ? shares(refCounts) : null;
    const max = Math.max(d3.max(sh), ref ? d3.max(ref) : 0, 1);
    const w = 340, lw = 132, vw = 46, rowH = 24, bh = 12;
    const x = d3.scaleLinear([0, max], [0, w - lw - vw]);
    const data = labels.map((l, i) => ({ l, v: sh[i], c: counts[i], r: ref ? ref[i] : null }));
    const s = d3.select(el).append("svg").attr("viewBox", [0, 0, w, data.length * rowH]).attr("role", "img");
    const g = s.selectAll("g").data(data).join("g").attr("transform", (d, i) => `translate(0,${i * rowH})`);
    g.append("rect").attr("x", 0).attr("y", 0).attr("width", w).attr("height", rowH).attr("fill", "transparent");
    g.append("text").attr("x", 0).attr("y", rowH / 2 + 4).text((d) => d.l);
    g.append("rect").attr("x", lw).attr("y", (rowH - bh) / 2).attr("height", bh).attr("rx", 2)
      .attr("width", (d) => Math.max(d.v > 0 ? 2 : 0, x(d.v))).attr("fill", color);
    if (ref) g.append("line").attr("class", "refmark").attr("x1", (d) => lw + x(d.r)).attr("x2", (d) => lw + x(d.r))
      .attr("y1", (rowH - bh) / 2 - 3).attr("y2", (rowH + bh) / 2 + 3);
    g.append("text").attr("class", "val").attr("x", w).attr("text-anchor", "end").attr("y", rowH / 2 + 4).text((d) => d.v.toFixed(1) + "%");
    chartTip(g, (d) => `<div class="tn">${d.l}</div><div class="tv"><span>Share</span><b>${d.v.toFixed(1)}%</b></div>
      <div class="tv"><span>Count</span><b>${fInt(d.c)}</b></div>${d.r != null ? `<div class="tv"><span>${D.name}</span><b>${d.r.toFixed(1)}%</b></div>` : ""}`);
  }

  function pyramid(el, s, ref) {
    const tot = s.pop || 1, rtot = ref ? ref.pop : 1;
    const bins = META.age_bins.map((b, i) => ({ b, m: (100 * s.d.age_m[i]) / tot, f: (100 * s.d.age_f[i]) / tot, cm: s.d.age_m[i], cf: s.d.age_f[i],
      rm: ref ? (100 * ref.d.age_m[i]) / rtot : null, rf: ref ? (100 * ref.d.age_f[i]) / rtot : null })).reverse();
    const max = d3.max(bins, (d) => Math.max(d.m, d.f, d.rm || 0, d.rf || 0)) || 1;
    const w = 340, mid = 170, lab = 22, rowH = 13, bh = 11;
    const x = d3.scaleLinear([0, max], [0, mid - lab - 4]);
    const sv = d3.select(el).append("svg").attr("viewBox", [0, 0, w, bins.length * rowH + 2]).attr("role", "img");
    const g = sv.selectAll("g").data(bins).join("g").attr("transform", (d, i) => `translate(0,${i * rowH})`);
    g.append("rect").attr("x", 0).attr("width", w).attr("height", rowH).attr("fill", "transparent");
    g.append("rect").attr("x", (d) => mid - lab - x(d.m)).attr("y", 1).attr("width", (d) => x(d.m)).attr("height", bh).attr("rx", 2).attr("fill", "var(--series-1)");
    g.append("rect").attr("x", mid + lab).attr("y", 1).attr("width", (d) => x(d.f)).attr("height", bh).attr("rx", 2).attr("fill", "var(--series-2)");
    if (ref) {
      g.append("line").attr("class", "refmark").attr("x1", (d) => mid - lab - x(d.rm)).attr("x2", (d) => mid - lab - x(d.rm)).attr("y1", 0).attr("y2", rowH);
      g.append("line").attr("class", "refmark").attr("x1", (d) => mid + lab + x(d.rf)).attr("x2", (d) => mid + lab + x(d.rf)).attr("y1", 0).attr("y2", rowH);
    }
    g.append("text").attr("x", mid).attr("y", rowH - 2.5).attr("text-anchor", "middle").style("font-size", "10px").text((d) => d.b);
    chartTip(g, (d) => `<div class="tn">Age ${d.b}</div><div class="tv"><span>Men</span><b>${fInt(d.cm)} · ${d.m.toFixed(1)}%</b></div>
      <div class="tv"><span>Women</span><b>${fInt(d.cf)} · ${d.f.toFixed(1)}%</b></div>`);
  }

  function columns(el, labels, counts, refCounts) {
    const sh = shares(counts), ref = refCounts ? shares(refCounts) : null;
    const max = Math.max(d3.max(sh), ref ? d3.max(ref) : 0, 1);
    const w = 340, h = 120, bottom = 18, n = labels.length, gap = 2;
    const bw = (w - gap * (n - 1)) / n;
    const y = d3.scaleLinear([0, max], [0, h - bottom - 4]);
    const sv = d3.select(el).append("svg").attr("viewBox", [0, 0, w, h]).attr("role", "img");
    sv.append("line").attr("x1", 0).attr("x2", w).attr("y1", h - bottom).attr("y2", h - bottom).attr("stroke", "var(--line-strong)");
    const data = labels.map((l, i) => ({ l, v: sh[i], c: counts[i], r: ref ? ref[i] : null, i }));
    const g = sv.selectAll("g.c").data(data).join("g").attr("class", "c").attr("transform", (d) => `translate(${d.i * (bw + gap)},0)`);
    g.append("rect").attr("width", bw).attr("height", h).attr("fill", "transparent");
    g.append("path").attr("fill", "var(--bar)").attr("d", (d) => {
      const hh = y(d.v), y0 = h - bottom, r = Math.min(2, hh);
      return `M0,${y0}V${y0 - hh + r}Q0,${y0 - hh} ${r},${y0 - hh}H${bw - r}Q${bw},${y0 - hh} ${bw},${y0 - hh + r}V${y0}Z`;
    });
    if (ref) g.append("line").attr("class", "refmark").attr("x1", 0).attr("x2", bw).attr("y1", (d) => h - bottom - y(d.r)).attr("y2", (d) => h - bottom - y(d.r));
    [0, 5, 9, 12, 15].forEach((i) => sv.append("text").attr("x", i * (bw + gap) + (i === 15 ? bw : 0)).attr("y", h - 4)
      .attr("text-anchor", i === 15 ? "end" : "start").style("font-size", "10px").text(labels[i]));
    chartTip(g, (d) => `<div class="tn">${d.l}</div><div class="tv"><span>Households</span><b>${fInt(d.c)} · ${d.v.toFixed(1)}%</b></div>
      ${d.r != null ? `<div class="tv"><span>${D.name}</span><b>${d.r.toFixed(1)}%</b></div>` : ""}`);
  }

  function kpi(label, id, mId) {
    const m = METRIC[mId];
    const isState = id === STATE_ID;
    const sv = D.geo[STATE_ID].m[mId], s = D.geo[id], v = s ? s.m[mId] : null, moe = s && s.moe[mId];
    const parts = [];
    if (has(v) && m.moe && moe != null && !isState) parts.push("±" + m.fmt(moe));
    parts.push(isState ? m.unit : D.name + ": " + (has(sv) ? m.fmt(sv) : "–"));
    return `<div class="kpi"><span class="k">${label}</span><span class="v">${has(v) ? m.fmt(v) : "No data"}</span>
      <span class="c">${parts.join(" · ")}</span></div>`;
  }

  function drawPanel() {
    const id = st.selected, f = byId.get(id), s = D.geo[id];
    const lvl = f.properties.level;
    const eyebrow = lvl === "state" ? "State" : lvl === "county" ? "County" : "Census tract · " + f.properties.county;
    const ref = id === STATE_ID ? null : S0;
    let note = "";
    if (lvl === "state") note = `${counties.length} counties · ${fInt(tracts.length)} census tracts. Click a county to see its tracts.`;
    if (lvl === "county") note = `${tracts.filter((t) => t.properties.GEOID.startsWith(id)).length} census tracts. Click one for its profile.`;
    if (lvl === "tract" && s && s.pop < 500) note = "Small population: estimates for this tract have wide margins of error.";
    const refKey = ref ? `<span class="reflegend"><i></i>${D.name}</span>` : "";

    panel.innerHTML = `<div class="ph"><div class="eyebrow">${eyebrow}</div><h2>${f.properties.name}</h2>${note ? `<div class="note">${note}</div>` : ""}</div>`;
    if (!s || !s.pop) { panel.insertAdjacentHTML("beforeend", `<p>No residents recorded in this area.</p>`); return; }
    panel.insertAdjacentHTML("beforeend", `<div class="kpis">
      <div class="kpi"><span class="k">Population</span><span class="v">${fInt(s.pop)}</span><span class="c">${has(s.m.density) ? fDens(s.m.density) + " per sq mi" : ""}</span></div>
      ${kpi("Median age", id, "median_age")}${kpi("Median household income", id, "median_income")}${kpi("Bachelor's or higher", id, "pct_ba_plus")}</div>`);

    const sec = (title, sub) => { const d = document.createElement("div"); d.className = "sec"; d.innerHTML = `<h3>${title}<small>${sub}</small></h3>`; panel.appendChild(d); return d; };

    const r = sec("Race & Ethnicity", refKey);
    hbars(r, META.race, s.d.race, ref && ref.d.race, "var(--bar)");
    r.insertAdjacentHTML("beforeend", `<div class="facts"><span>Diversity index <b>${has(s.m.diversity) ? Math.round(s.m.diversity) + "%" : "–"}</b></span></div>`);

    const a = sec("Age & Sex", ref ? refKey : "share of residents");
    a.insertAdjacentHTML("beforeend", `<div class="pyrkey"><span><i style="background:var(--series-1)"></i>Men</span><span><i style="background:var(--series-2)"></i>Women</span></div>`);
    pyramid(a, s, ref);
    a.insertAdjacentHTML("beforeend", `<div class="facts"><span>Under 18 <b>${has(s.m.pct_under18) ? fPct(s.m.pct_under18) : "–"}</b></span>
      <span>65+ <b>${has(s.m.pct_65plus) ? fPct(s.m.pct_65plus) : "–"}</b></span><span>Men per 100 women <b>${has(s.m.sex_ratio) ? s.m.sex_ratio.toFixed(1) : "–"}</b></span></div>`);

    const e = sec("Education", ref ? refKey : "adults 25 and older");
    hbars(e, META.edu, s.d.edu, ref && ref.d.edu, "var(--bar)");

    const i = sec("Household Income", ref ? refKey : "share of households");
    columns(i, META.income_bins, s.d.income, ref && ref.d.income);
    i.insertAdjacentHTML("beforeend", `<div class="facts"><span>Poverty rate <b>${has(s.m.poverty) ? fPct(s.m.poverty) : "–"}</b></span>
      <span>Gini index <b>${fmtVal(id, "gini")}</b></span></div>`);

    panel.insertAdjacentHTML("beforeend", `<div class="foot">Source: U.S. Census Bureau, American Community Survey 2019–2023 5-year estimates
      (tables B01001, B01002, B03002, B15003, B17001, B19001, B19013, B19083). ± values are 90% margins of error.
      Race groups other than Hispanic are non-Hispanic.</div>`);
  }

  // ---------- boot ----------
  drawTopics(); drawMetrics();
  const redraw = () => { paint(); if (!panel.hidden) drawPanel(); };
  mq.addEventListener("change", redraw);
  new MutationObserver(redraw).observe(root, { attributes: true, attributeFilter: ["data-theme"] });
  new ResizeObserver(() => { if (st.view === "map") layout(); }).observe(mapbox);
  layout(); update(false);
})();
