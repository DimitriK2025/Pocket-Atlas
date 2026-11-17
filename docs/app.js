/* Midwest Atlas front end. Needs d3, topojson and window.ATLAS_REGION (docs/data/region.js).
   The region file holds state outlines, counties and their statistics. Each state's census
   tracts live in docs/data/<state>.js and load the first time that state's tracts are shown.
   Topics, metrics and charts are all described in ATLAS_REGION.meta (see scripts/process_acs.py). */
(function () {
  "use strict";
  const R = window.ATLAS_REGION;
  const GEO = R.geo; // stats by GEOID; tract stats are merged in as states load
  const META = R.meta, RACE = META.race;
  const STATES = R.states; // [{fips, name, abbr, id, tracts}]
  const SBY = new Map(STATES.map((s) => [s.fips, s]));
  const SBYID = new Map(STATES.map((s) => [s.id, s]));

  // ---------- geometry ----------
  const stateFeats = topojson.feature(R.topo, R.topo.objects.states).features;
  const countyFeats = topojson.feature(R.topo, R.topo.objects.counties).features;
  const stateMesh = topojson.mesh(R.topo, R.topo.objects.states, (a, b) => a !== b);
  const regionOutline = topojson.mesh(R.topo, R.topo.objects.states, (a, b) => a === b);
  const countyMesh = topojson.mesh(R.topo, R.topo.objects.counties, (a, b) => a !== b);
  const regionFeat = topojson.merge(R.topo, R.topo.objects.states.geometries);
  const byId = new Map();
  stateFeats.forEach((f) => { const p = f.properties; p.level = "state"; p.name = p.NAME; byId.set(p.GEOID, f); });
  countyFeats.forEach((f) => { const p = f.properties; p.level = "county"; p.state = p.GEOID.slice(0, 2); byId.set(p.GEOID, f); });
  const tractFeats = {}; // state fips -> features (once loaded)
  const tractSel = {};   // state fips -> d3 selection of paths
  const countiesOf = (fips) => countyFeats.filter((f) => f.properties.state === fips);

  // derived: population density (people per square mile of land)
  const SQMI = 2589988.11;
  const land = {};
  countyFeats.forEach((f) => {
    const p = f.properties, s = GEO[p.GEOID];
    land[p.state] = (land[p.state] || 0) + +p.aland;
    if (s) s.m.density = p.aland > 0 ? s.pop / (p.aland / SQMI) : null;
  });
  STATES.forEach((s) => { const g = GEO[s.fips]; if (g) g.m.density = g.pop / (land[s.fips] / SQMI); });
  const regionPop = d3.sum(STATES, (s) => (GEO[s.fips] ? GEO[s.fips].pop : 0));

  // ---------- formatting ----------
  const fInt = d3.format(",");
  const fDens = (v) => (v < 10 ? v.toFixed(1) : fInt(Math.round(v)));
  const FMT = {
    pct: { f: (v) => v.toFixed(1) + "%", t: (v) => (v < 10 && v % 1 ? v.toFixed(1) : Math.round(v)) + "%" },
    int: { f: fInt, t: (v) => d3.format(".2~s")(v) },
    dens: { f: fDens, t: (v) => fInt(Math.round(v)) },
    money: { f: d3.format("$,.0f"), t: (v) => (v >= 10000 ? "$" + Math.round(v / 1000) + "k" : d3.format("$,.0f")(v)) },
    dec1: { f: (v) => v.toFixed(1), t: (v) => (v % 1 ? v.toFixed(1) : String(v)) },
    dec2: { f: (v) => v.toFixed(2), t: (v) => v.toFixed(2) },
    dec3: { f: (v) => v.toFixed(3), t: (v) => v.toFixed(2) },
    year: { f: (v) => String(Math.round(v)), t: (v) => String(Math.round(v)) },
    min: { f: (v) => v.toFixed(1) + " min", t: (v) => Math.round(v) + "" },
    cat: { f: (v) => RACE[v], t: String },
  };
  function niceRound(v, fmt) {
    switch (fmt) {
      case "money": return v >= 20000 ? Math.round(v / 1000) * 1000 : v >= 2000 ? Math.round(v / 100) * 100 : Math.round(v / 10) * 10;
      case "dec3": return Math.round(v * 100) / 100;
      case "dec2": return Math.round(v * 20) / 20;
      case "year": case "min": return Math.round(v);
      case "int": case "dens": {
        const p = Math.pow(10, Math.max(0, Math.floor(Math.log10(Math.abs(v) || 1)) - 1));
        return Math.round(v / p) * p;
      }
      default: return v >= 10 ? Math.round(v) : Math.round(v * 10) / 10;
    }
  }

  // ---------- topics / metrics ----------
  const TOPICS = META.topics;
  const METRIC = {};
  TOPICS.forEach((t) => t.metrics.forEach((m) => (METRIC[m.id] = Object.assign(m, { topic: t.id }))));

  // ---------- palettes ----------
  // Sequential: near-white (lowest) -> the chart blue #0f5499 (highest).
  const SEQ = ["#f8fafc", "#d4e0ed", "#adc5dc", "#87aacc", "#618ebc", "#3871aa", "#0f5499"];
  // Diverging (sex ratio): blue = more women, red = more men, neutral midpoint.
  const DIV = ["#0f5499", "#4f88c6", "#a9c9e8", "#f2e6dc", "#f7ae8f", "#d9503f", "#7a0a24"];
  // Categorical (largest group)
  const CAT = ["#0f5499", "#990f3d", "#0d7680", "#e3a000", "#eb5e8d", "#593380"];

  // ---------- state ----------
  // state: open state's FIPS (null = whole region); focus: open county; selected: profiled place (null = region)
  const st = { metric: "median_income", level: "state", state: null, focus: null, selected: null,
    view: "map", sort: { key: "value", dir: -1 } };
  const eff = () => (st.focus ? "tract" : st.state && st.level === "state" ? "county" : st.level);

  // ---------- DOM ----------
  const $ = (s) => document.querySelector(s);
  const selEl = $("#metric-select");
  const mapbox = $("#mapbox"), tablebox = $("#tablebox"), legendEl = $("#legend"), panel = $("#panel"), tip = $("#tip");
  const loadEl = $("#maploading"), hintEl = $("#maphint");
  $("#source").textContent = "American Community Survey, " + R.source.replace("ACS 5-year estimates, ", "") + " 5-year estimates · U.S. Census Bureau";

  // ---------- map ----------
  const svg = d3.select("#map");
  const gZoom = svg.append("g");
  const gState = gZoom.append("g");
  const gCounty = gZoom.append("g");
  const gTract = gZoom.append("g");
  const countyMeshPath = gZoom.append("path").attr("class", "mesh");
  const stateMeshPath = gZoom.append("path").attr("class", "statemesh");
  const outlinePath = gZoom.append("path").attr("class", "outline");
  const selHalo = gZoom.append("path").attr("class", "sel-halo");
  const selPath = gZoom.append("path").attr("class", "sel");
  let geoPath, W = 0, H = 0;
  const zoom = d3.zoom().scaleExtent([1, 120]).on("zoom", (e) => gZoom.attr("transform", e.transform));
  svg.call(zoom).on("dblclick.zoom", null);

  const stateSel = gState.selectAll("path").data(stateFeats).join("path").attr("class", "unit");
  const countySel = gCounty.selectAll("path").data(countyFeats).join("path").attr("class", "unit");

  function layout() {
    const r = mapbox.getBoundingClientRect();
    W = Math.max(r.width, 200); H = Math.max(r.height, 200);
    svg.attr("viewBox", [0, 0, W, H]);
    const c = d3.geoCentroid(regionFeat);
    const projection = d3.geoConicConformal().rotate([-c[0], 0]).parallels([c[1] - 4, c[1] + 4])
      .fitExtent([[16, 16], [W - 16, H - 16]], regionFeat);
    geoPath = d3.geoPath(projection);
    stateSel.attr("d", geoPath);
    countySel.attr("d", geoPath);
    Object.values(tractSel).forEach((s) => s.attr("d", geoPath));
    countyMeshPath.attr("d", geoPath(countyMesh));
    stateMeshPath.attr("d", geoPath(stateMesh));
    outlinePath.attr("d", geoPath(regionOutline));
    drawSelection();
    zoomToCurrent(false);
  }

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  function zoomToFeature(f, animate) {
    let t = d3.zoomIdentity;
    if (f) {
      const [[x0, y0], [x1, y1]] = geoPath.bounds(f);
      const k = Math.min(100, 0.88 / Math.max((x1 - x0) / W, (y1 - y0) / H));
      t = d3.zoomIdentity.translate(W / 2, H / 2).scale(k).translate(-(x0 + x1) / 2, -(y0 + y1) / 2);
    }
    (animate && !reduceMotion ? svg.transition().duration(750) : svg).call(zoom.transform, t);
  }
  function zoomToCurrent(animate) { zoomToFeature(st.focus ? byId.get(st.focus) : st.state ? byId.get(st.state) : null, animate); }

  // ---------- loading a state's tracts ----------
  const pending = {};
  window.ATLAS_TRACTS = window.ATLAS_TRACTS || {};
  function ensureTracts(fips, cb) {
    if (tractFeats[fips]) { if (cb) cb(); return; }
    const s = SBY.get(fips);
    const first = !pending[fips];
    (pending[fips] = pending[fips] || []).push(cb);
    if (!first) return;
    loadEl.textContent = `Loading ${s.name} census tracts…`;
    loadEl.hidden = false;
    const sc = document.createElement("script");
    sc.src = "data/" + s.id + ".js?v=" + (window.ATLAS_VERSION || "");
    sc.onload = () => {
      addTracts(fips, window.ATLAS_TRACTS[fips]);
      delete window.ATLAS_TRACTS[fips];
      loadEl.hidden = true;
      const cbs = pending[fips]; delete pending[fips];
      cbs.forEach((f) => f && f());
    };
    sc.onerror = () => {
      delete pending[fips];
      loadEl.textContent = `Couldn't load ${s.name}'s census tracts. Check your connection and try again.`;
    };
    document.body.appendChild(sc);
  }
  function addTracts(fips, T) {
    Object.assign(GEO, T.geo);
    const feats = topojson.feature(T.topo, T.topo.objects.tracts).features;
    feats.forEach((f) => {
      const p = f.properties, s = GEO[p.GEOID];
      p.level = "tract"; p.state = fips; byId.set(p.GEOID, f);
      if (s) s.m.density = p.aland > 0 ? s.pop / (p.aland / SQMI) : null;
    });
    tractFeats[fips] = feats;
    const sel = gTract.append("g").selectAll("path").data(feats).join("path").attr("class", "unit");
    if (geoPath) sel.attr("d", geoPath);
    hookUnits(sel);
    sel.on("click", (e, f) => { hideTip(); select(f.properties.GEOID); });
    tractSel[fips] = sel;
  }

  // ---------- classification ----------
  const has = (v) => v !== null && v !== undefined && !Number.isNaN(v);
  const val = (id, mId) => { const s = GEO[id]; return s ? s.m[mId || st.metric] : null; };
  function refUnits() {
    const L = eff();
    if (L === "state") return stateFeats;
    if (L === "county") return countyFeats;
    return tractFeats[st.state] || [];
  }
  function visibleUnits() {
    const L = eff();
    if (L === "state") return stateFeats;
    if (L === "county") return st.state ? countiesOf(st.state) : countyFeats;
    const t = tractFeats[st.state] || [];
    return st.focus ? t.filter((f) => f.properties.GEOID.startsWith(st.focus)) : t;
  }
  let scale = null;
  function buildScale() {
    const m = METRIC[st.metric];
    if (m.type === "cat") {
      const present = new Set(refUnits().map((f) => val(f.properties.GEOID)).filter(has));
      scale = { type: "cat", color: (v) => CAT[v], present: [...present].sort() };
      return;
    }
    let th;
    if (m.type === "div") th = m.thresholds;
    else {
      const vals = refUnits().map((f) => val(f.properties.GEOID)).filter(has);
      th = vals.length ? d3.scaleQuantile().domain(vals).range(d3.range(7)).quantiles().map((v) => niceRound(v, m.fmt)) : [];
      th = th.filter((v, i) => i === 0 || v > th[i - 1]);
    }
    const colors = m.type === "div" ? DIV : SEQ;
    const used = colors.length === th.length + 1 ? colors : d3.quantize(d3.interpolateRgbBasis(colors), Math.max(2, th.length + 1));
    scale = { type: "num", th, colors: used, color: (v) => used[d3.bisectRight(th, v)] };
  }
  const fillOf = (f) => { const v = val(f.properties.GEOID); return has(v) ? scale.color(v) : "var(--nodata)"; };

  function paint() {
    buildScale();
    const L = eff();
    stateSel.attr("fill", fillOf).style("display", L === "state" ? null : "none");
    countySel.attr("fill", fillOf)
      .style("display", (f) => {
        const p = f.properties;
        if (L === "state") return "none";
        if (L === "tract") return (st.focus ? p.GEOID === st.focus : p.state === st.state) ? "none" : null;
        return null;
      })
      .classed("dim", (f) => !!st.state && (L === "tract" || f.properties.state !== st.state));
    Object.entries(tractSel).forEach(([fips, sel]) => {
      const on = L === "tract" && fips === st.state;
      sel.attr("fill", on ? fillOf : null)
        .style("display", (f) => (on && (!st.focus || f.properties.GEOID.startsWith(st.focus)) ? null : "none"));
    });
    countyMeshPath.style("display", L === "state" ? "none" : null);
    hintEl.textContent = !st.state ? (L === "state" ? "Click a state to explore it" : "Click a county to see its census tracts")
      : "Scroll or pinch to zoom · drag to pan · Esc to go back";
    drawLegend();
    if (st.view === "table") drawTable();
  }

  function drawSelection() {
    const f = st.selected ? byId.get(st.selected) : null;
    const d = f && geoPath ? geoPath(f) : null;
    selPath.attr("d", d); selHalo.attr("d", d);
  }

  // ---------- legend ----------
  function drawLegend() {
    const m = METRIC[st.metric], L = eff();
    const where = L === "state" ? null : L === "county" ? `${R.name} counties` : `${SBY.get(st.state).name} census tracts`;
    const how = m.type === "cat" ? "" : m.type === "div" ? " · fixed breaks" : where ? ` · 7 equal-count groups of ${where}` : " · states shaded lowest to highest";
    let h = `<div class="ltitle" title="${m.label}: ${m.unit}${how}"><b>${m.label}</b><span>${m.unit}${how}</span></div>`;
    if (L === "tract" && !tractFeats[st.state]) { legendEl.innerHTML = h; return; }
    if (scale.type === "cat") {
      h += `<div class="catlegend">${scale.present.map((i) => `<span><i style="background:${CAT[i]}"></i>${RACE[i]}</span>`).join("")}
        <span class="nd"><i></i>No data</span></div>`;
      legendEl.innerHTML = h;
      return;
    }
    const tick = FMT[m.fmt].t;
    h += `<div class="scale"><div class="swatches">${scale.colors.map((c) => `<i style="background:${c}"></i>`).join("")}<i class="ndsw"></i></div>
      <div class="ticks">${scale.th.map((t) => `<span>${tick(t)}</span>`).join("")}<span class="ndt">No data</span></div></div>`;
    legendEl.innerHTML = h;
    placeTicks();
  }
  // tick labels sit on the boundaries between swatches
  function placeTicks() {
    const sw = [...legendEl.querySelectorAll(".swatches i")];
    if (!sw.length) return;
    const x0 = sw[0].getBoundingClientRect().left;
    const ticks = legendEl.querySelector(".ticks");
    ticks.style.width = sw[sw.length - 1].getBoundingClientRect().right - x0 + "px";
    const spans = [...ticks.querySelectorAll("span")];
    spans.forEach((s, i) => {
      const r = s.classList.contains("ndt") ? sw[sw.length - 1].getBoundingClientRect() : sw[i].getBoundingClientRect();
      s.style.left = (s.classList.contains("ndt") ? (r.left + r.right) / 2 : r.right + 1) - x0 + "px";
    });
  }

  // ---------- names and values ----------
  function placeName(id) {
    if (!id) return "The " + R.name;
    const f = byId.get(id);
    return f ? f.properties.name : id;
  }
  function fmtVal(id, mId, withMoe = true) {
    const m = METRIC[mId || st.metric], s = GEO[id];
    if (!s) return "No data";
    const v = s.m[m.id];
    if (!has(v)) return "No data";
    let out = FMT[m.fmt].f(v);
    if (withMoe && m.moe && s.moe && has(s.moe[m.id])) out += ` <span class="tc">±${FMT[m.fmt].f(s.moe[m.id])}</span>`;
    return out;
  }

  // ---------- tooltip ----------
  function showTip(e, f) {
    const p = f.properties, s = GEO[p.GEOID], abbr = SBY.get(p.state || p.GEOID).abbr;
    const sub = p.level === "tract" ? `${p.county}, ${abbr}` : p.level === "county" ? SBY.get(p.state).name : "";
    tip.innerHTML = `<div class="tn">${p.name}</div>${sub ? `<div class="tc">${sub}</div>` : ""}
      <div class="tv"><span>${METRIC[st.metric].label}</span><b>${fmtVal(p.GEOID)}</b></div>
      <div class="tv"><span>Population</span><b>${s ? fInt(s.pop) : "–"}</b></div>`;
    tip.hidden = false;
    const r = mapbox.getBoundingClientRect(), tw = tip.offsetWidth, th = tip.offsetHeight;
    let x = e.clientX - r.left + 14, y = e.clientY - r.top + 14;
    if (x + tw > r.width - 8) x = e.clientX - r.left - tw - 14;
    if (y + th > r.height - 8) y = e.clientY - r.top - th - 14;
    tip.style.left = Math.max(8, x) + "px"; tip.style.top = Math.max(8, y) + "px";
  }
  function hideTip() { tip.hidden = true; }
  function hookUnits(sel) { sel.on("pointermove", (e, f) => { if (e.pointerType !== "touch") showTip(e, f); }).on("pointerleave", hideTip); }
  hookUnits(stateSel); hookUnits(countySel);

  // ---------- navigation ----------
  stateSel.on("click", (e, f) => { hideTip(); focusState(f.properties.GEOID); });
  countySel.on("click", (e, f) => { hideTip(); focusCounty(f.properties.GEOID); });

  function setHash() {
    const id = st.state ? SBY.get(st.state).id : "";
    if (decodeURIComponent(location.hash.slice(1)) === id) return;
    if (id) location.hash = id;
    else { try { history.replaceState(null, "", location.pathname + location.search); } catch (err) { location.hash = ""; } }
  }
  function focusState(fips) {
    st.state = fips; st.focus = null; st.selected = fips;
    if (st.level === "state") st.level = "county";
    setHash();
    update(true);
    if (st.level === "tract") ensureTracts(fips, () => update(false));
  }
  function focusCounty(cid) {
    st.state = cid.slice(0, 2); st.focus = cid; st.selected = cid;
    setHash();
    update(true);
    ensureTracts(st.state, () => update(false));
  }
  function select(id) { st.selected = id; update(false); }
  function goRegion() {
    st.state = null; st.focus = null; st.selected = null;
    if (st.level === "tract") st.level = "county";
    setHash();
    update(true);
  }
  function goUp() {
    if (st.selected && st.selected.length === 11) { if (st.focus) select(st.focus); else focusState(st.state); }
    else if (st.focus) focusState(st.state);
    else if (st.state) goRegion();
  }
  function update(rezoom) {
    syncControls();
    paint(); drawSelection(); drawPanel(); syncResetButton();
    if (rezoom) zoomToCurrent(true);
  }
  function setMetric(mid) { st.metric = mid; update(false); }
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && document.activeElement !== selEl) goUp();
  });
  window.addEventListener("hashchange", () => {
    const s = SBYID.get(decodeURIComponent(location.hash.slice(1)).toLowerCase());
    if (s && s.fips !== st.state) focusState(s.fips);
    else if (!s && st.state && !location.hash.slice(1)) goRegion();
  });

  function drawCrumbs() {
    const crumbsEl = document.getElementById("crumbs");
    if (!crumbsEl) return;
    const parts = [{ act: "region", label: "The " + R.name }];
    if (st.state) parts.push({ act: "state", id: st.state, label: SBY.get(st.state).name });
    if (st.focus) parts.push({ act: "county", id: st.focus, label: placeName(st.focus) });
    if (st.selected && st.selected.length === 11) parts.push({ label: placeName(st.selected) });
    crumbsEl.innerHTML = parts.map((p, i) => i === parts.length - 1
      ? `<span class="here">${p.label}</span>`
      : `<button data-act="${p.act}" data-id="${p.id || ""}">${p.label}</button><span class="sep">›</span>`).join("");
    crumbsEl.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
      if (b.dataset.act === "region") goRegion();
      else if (b.dataset.act === "state") focusState(b.dataset.id);
      else focusCounty(b.dataset.id);
    }));
  }

  // ---------- controls ----------
  function drawSelect() {
    selEl.innerHTML = TOPICS.map((t) => `<optgroup label="${t.label}">${t.metrics
      .map((m) => `<option value="${m.id}">${m.label}</option>`).join("")}</optgroup>`).join("");
    selEl.addEventListener("change", () => setMetric(selEl.value));
  }
  function syncControls() {
    selEl.value = st.metric;
    const L = eff();
    document.querySelectorAll("[data-level]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.level === L));
    const tr = $("#lvl-tract");
    tr.disabled = !st.state;
    tr.title = st.state ? "" : "Open a state to see its census tracts";
    document.querySelectorAll("[data-view]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.view === st.view));
  }
  document.querySelectorAll("[data-level]").forEach((b) => b.addEventListener("click", () => {
    const lv = b.dataset.level;
    if (lv === "state") { st.level = "state"; if (st.state) goRegion(); else update(false); return; }
    if (lv === "county") {
      st.level = "county";
      if (st.focus) { st.focus = null; st.selected = st.state; update(true); } else update(false);
      return;
    }
    if (!st.state) return;
    st.level = "tract";
    if (st.selected && st.selected.length === 11 && !st.focus) st.selected = st.state;
    update(false);
    ensureTracts(st.state, () => update(false));
  }));
  document.querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => {
    st.view = b.dataset.view;
    mapbox.hidden = st.view !== "map"; tablebox.hidden = st.view !== "table";
    if (st.view === "map") layout();
    update(false);
  }));
  $("#zin").addEventListener("click", () => svg.transition().duration(300).call(zoom.scaleBy, 1.6));
  $("#zout").addEventListener("click", () => svg.transition().duration(300).call(zoom.scaleBy, 1 / 1.6));
  const zreset = $("#zreset");
  zreset.addEventListener("click", () => { if (st.state) goUp(); else zoomToCurrent(true); });
  function syncResetButton() {
    const open = !!st.state;
    zreset.textContent = open ? "×" : "⤢";
    zreset.setAttribute("aria-label", open ? "Close and go back one level" : "Reset zoom");
    zreset.title = open ? "Close" : "Reset zoom";
    zreset.classList.toggle("close", open);
  }

  // ---------- table view ----------
  function drawTable() {
    const m = METRIC[st.metric], L = eff();
    const units = visibleUnits();
    const extra = L === "tract" ? "county" : L === "county" && !st.state ? "state" : null;
    const rows = units.map((f) => {
      const p = f.properties, s = GEO[p.GEOID];
      return { id: p.GEOID, name: p.name, extra: extra === "county" ? p.county : extra === "state" ? SBY.get(p.state).name : "",
        pop: s ? s.pop : null, value: s ? s.m[m.id] : null };
    });
    const { key, dir } = st.sort;
    rows.sort((a, b) => {
      const x = a[key], y = b[key];
      if (!has(x) && !has(y)) return 0; if (!has(x)) return 1; if (!has(y)) return -1;
      return (typeof x === "string" ? x.localeCompare(y) : x - y) * dir;
    });
    const arrow = (k) => (st.sort.key === k ? (st.sort.dir > 0 ? " ▲" : " ▼") : "");
    tablebox.innerHTML = `<table><thead><tr>
      <th data-k="name">Name${arrow("name")}</th>${extra ? `<th data-k="extra">${extra === "county" ? "County" : "State"}${arrow("extra")}</th>` : ""}
      <th class="num" data-k="pop">Population${arrow("pop")}</th><th class="num" data-k="value">${m.label}${arrow("value")}</th></tr></thead>
      <tbody>${rows.map((r) => `<tr data-id="${r.id}" class="${r.id === st.selected ? "on" : ""}"><td>${r.name}</td>${extra ? `<td>${r.extra}</td>` : ""}
      <td class="num">${has(r.pop) ? fInt(r.pop) : "–"}</td><td class="num">${fmtVal(r.id)}</td></tr>`).join("")}</tbody></table>`;
    tablebox.querySelectorAll("th").forEach((th) => th.addEventListener("click", () => {
      const k = th.dataset.k;
      st.sort = { key: k, dir: st.sort.key === k ? -st.sort.dir : k === "name" || k === "extra" ? 1 : -1 };
      drawTable();
    }));
    tablebox.querySelectorAll("tbody tr").forEach((tr) => tr.addEventListener("click", () => {
      const id = tr.dataset.id;
      if (id.length === 2) focusState(id);
      else if (id.length === 5 && !st.focus) focusCounty(id);
      else select(id);
    }));
  }

  // ---------- profile panel charts ----------
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
  // charts draw at the panel's real width so text stays a normal size
  const chartW = (el) => Math.max(260, Math.min(820, Math.floor(el.getBoundingClientRect().width) || 340));
  const toShares = (arr, total) => {
    const t = total || d3.sum(arr, (v) => v || 0);
    return arr.map((v) => (t && has(v) ? (100 * v) / t : null));
  };

  // Bars with the label above each bar (labels can be long); optional reference tick and click handler.
  function bars(el, labels, values, refs, fmt, counts, refName, onClick) {
    const F = FMT[fmt].f;
    const max = Math.max(d3.max(values, (v) => v || 0), refs ? d3.max(refs, (v) => v || 0) : 0) || 1;
    const w = chartW(el), rowH = 30, bh = 9;
    const x = d3.scaleLinear([0, max], [0, w]);
    const data = labels.map((l, i) => ({ l, i, v: values[i], r: refs ? refs[i] : null, c: counts ? counts[i] : null }));
    const s = d3.select(el).append("svg").attr("viewBox", [0, 0, w, data.length * rowH]).attr("role", "img");
    const g = s.selectAll("g").data(data).join("g").attr("transform", (d, i) => `translate(0,${i * rowH})`);
    g.append("rect").attr("width", w).attr("height", rowH).attr("fill", "transparent");
    g.append("text").attr("x", 0).attr("y", 12).text((d) => d.l);
    g.append("text").attr("class", "val").attr("x", w).attr("y", 12).attr("text-anchor", "end").text((d) => (has(d.v) ? F(d.v) : "–"));
    g.append("rect").attr("x", 0).attr("y", 17).attr("width", w).attr("height", bh).attr("fill", "var(--track)");
    g.append("rect").attr("x", 0).attr("y", 17).attr("height", bh)
      .attr("width", (d) => (has(d.v) ? Math.max(d.v > 0 ? 2 : 0, x(d.v)) : 0)).attr("fill", "var(--bar)");
    if (refs) g.filter((d) => has(d.r)).append("line").attr("class", "refmark")
      .attr("x1", (d) => x(d.r)).attr("x2", (d) => x(d.r)).attr("y1", 14).attr("y2", 29);
    if (onClick) g.style("cursor", "pointer").on("click", (e, d) => { ctip.hidden = true; onClick(d.i); });
    chartTip(g, (d) => `<div class="tn">${d.l}</div><div class="tv"><span>Value</span><b>${has(d.v) ? F(d.v) : "–"}</b></div>
      ${has(d.c) ? `<div class="tv"><span>Count</span><b>${fInt(d.c)}</b></div>` : ""}
      ${has(d.r) ? `<div class="tv"><span>${refName}</span><b>${F(d.r)}</b></div>` : ""}`);
  }

  function columns(el, labels, values, refs, counts, refName) {
    const max = Math.max(d3.max(values, (v) => v || 0), refs ? d3.max(refs, (v) => v || 0) : 0) || 1;
    const w = chartW(el), h = 130, bottom = 18, n = labels.length, gap = 2;
    const bw = (w - gap * (n - 1)) / n;
    const y = d3.scaleLinear([0, max], [0, h - bottom - 4]);
    const sv = d3.select(el).append("svg").attr("viewBox", [0, 0, w, h]).attr("role", "img");
    sv.append("line").attr("x1", 0).attr("x2", w).attr("y1", h - bottom).attr("y2", h - bottom).attr("stroke", "var(--line-strong)");
    const data = labels.map((l, i) => ({ l, v: values[i] || 0, r: refs ? refs[i] : null, c: counts ? counts[i] : null, i }));
    const g = sv.selectAll("g.c").data(data).join("g").attr("class", "c").attr("transform", (d) => `translate(${d.i * (bw + gap)},0)`);
    g.append("rect").attr("width", bw).attr("height", h).attr("fill", "transparent");
    g.append("path").attr("fill", "var(--bar)").attr("d", (d) => {
      const hh = y(d.v), y0 = h - bottom, r = Math.min(2, hh);
      return `M0,${y0}V${y0 - hh + r}Q0,${y0 - hh} ${r},${y0 - hh}H${bw - r}Q${bw},${y0 - hh} ${bw},${y0 - hh + r}V${y0}Z`;
    });
    if (refs) g.filter((d) => has(d.r)).append("line").attr("class", "refmark").attr("x1", 0).attr("x2", bw)
      .attr("y1", (d) => h - bottom - y(d.r)).attr("y2", (d) => h - bottom - y(d.r));
    const show = n <= 7 ? d3.range(n) : [0, Math.round((n - 1) / 3), Math.round((2 * (n - 1)) / 3), n - 1];
    show.forEach((i) => sv.append("text").attr("x", i * (bw + gap) + (n > 7 && i === n - 1 ? bw : n > 7 && i === 0 ? 0 : bw / 2)).attr("y", h - 4)
      .attr("text-anchor", n > 7 && i === n - 1 ? "end" : n > 7 && i === 0 ? "start" : "middle").style("font-size", "10.5px").text(labels[i]));
    chartTip(g, (d) => `<div class="tn">${d.l}</div><div class="tv"><span>Share</span><b>${d.v.toFixed(1)}%</b></div>
      ${has(d.c) ? `<div class="tv"><span>Count</span><b>${fInt(d.c)}</b></div>` : ""}
      ${has(d.r) ? `<div class="tv"><span>${refName}</span><b>${d.r.toFixed(1)}%</b></div>` : ""}`);
  }

  function pyramid(el, counts, refCounts, labels) {
    const n = labels.length;
    const tot = d3.sum(counts) || 1, rtot = refCounts ? d3.sum(refCounts) : 1;
    const bins = labels.map((b, i) => ({ b, m: (100 * counts[i]) / tot, f: (100 * counts[i + n]) / tot, cm: counts[i], cf: counts[i + n],
      rm: refCounts ? (100 * refCounts[i]) / rtot : null, rf: refCounts ? (100 * refCounts[i + n]) / rtot : null })).reverse();
    const max = d3.max(bins, (d) => Math.max(d.m, d.f, d.rm || 0, d.rf || 0)) || 1;
    const w = chartW(el), mid = w / 2, lab = 22, rowH = 14, bh = 12;
    const x = d3.scaleLinear([0, max], [0, mid - lab - 4]);
    const sv = d3.select(el).append("svg").attr("viewBox", [0, 0, w, bins.length * rowH + 2]).attr("role", "img");
    const g = sv.selectAll("g").data(bins).join("g").attr("transform", (d, i) => `translate(0,${i * rowH})`);
    g.append("rect").attr("x", 0).attr("width", w).attr("height", rowH).attr("fill", "transparent");
    g.append("rect").attr("x", (d) => mid - lab - x(d.m)).attr("y", 1).attr("width", (d) => x(d.m)).attr("height", bh).attr("fill", "var(--series-1)");
    g.append("rect").attr("x", mid + lab).attr("y", 1).attr("width", (d) => x(d.f)).attr("height", bh).attr("fill", "var(--series-2)");
    if (refCounts) {
      g.append("line").attr("class", "refmark").attr("x1", (d) => mid - lab - x(d.rm)).attr("x2", (d) => mid - lab - x(d.rm)).attr("y1", 0).attr("y2", rowH);
      g.append("line").attr("class", "refmark").attr("x1", (d) => mid + lab + x(d.rf)).attr("x2", (d) => mid + lab + x(d.rf)).attr("y1", 0).attr("y2", rowH);
    }
    g.append("text").attr("x", mid).attr("y", rowH - 2.5).attr("text-anchor", "middle").style("font-size", "10px").text((d) => d.b);
    chartTip(g, (d) => `<div class="tn">Age ${d.b}</div><div class="tv"><span>Men</span><b>${fInt(d.cm)} · ${d.m.toFixed(1)}%</b></div>
      <div class="tv"><span>Women</span><b>${fInt(d.cf)} · ${d.f.toFixed(1)}%</b></div>`);
  }

  function drawChart(sec, c, s, ref, refName) {
    const cur = s.d[c.id], rd = ref ? ref.d[c.id] : null;
    if (!cur || cur.every((v) => !has(v) || v === 0)) { sec.insertAdjacentHTML("beforeend", `<p class="empty">No data for this place.</p>`); return; }
    if (c.kind === "pyramid") {
      sec.insertAdjacentHTML("beforeend", `<div class="pyrkey"><span><i style="background:var(--series-1)"></i>Men</span><span><i style="background:var(--series-2)"></i>Women</span></div>`);
      pyramid(sec, cur, rd, c.labels);
    } else if (c.kind === "values") {
      bars(sec, c.labels, cur, rd, c.fmt, null, refName);
    } else if (c.kind === "hist") {
      columns(sec, c.labels, toShares(cur), rd && toShares(rd), cur, refName);
    } else {
      const t = c.of_total ? (s.t || {})[c.id] : null, rt = c.of_total && ref ? (ref.t || {})[c.id] : null;
      bars(sec, c.labels, toShares(cur, t), rd && toShares(rd, rt), "pct", cur, refName);
    }
  }

  function drawPanel() {
    const id = st.selected, topic = TOPICS.find((t) => t.id === METRIC[st.metric].topic);
    const foot = `<div class="foot">Source: U.S. Census Bureau, American Community Survey 2019–2023 5-year estimates.
      ± values are 90% margins of error. Census tracts average about 4,000 residents, so small differences between tracts are often within the margin of error.</div>`;

    if (!id) {
      // the whole region: compare the states on the current statistic
      const m = METRIC[st.metric];
      const nTracts = d3.sum(STATES, (s) => s.tracts);
      panel.innerHTML = `<div class="ph"><nav class="crumbs" id="crumbs" aria-label="Location"></nav><h2>The ${R.name}</h2>
        <div class="note">Population ${fInt(regionPop)} · ${STATES.length} states · ${fInt(countyFeats.length)} counties · ${fInt(nTracts)} census tracts. Click a state to explore it.</div></div>`;
      const sec = document.createElement("div");
      sec.className = "sec";
      sec.innerHTML = `<h3>${m.label}<small>by state</small></h3><div class="csub">${m.unit}</div>`;
      panel.appendChild(sec);
      drawCrumbs();
      if (m.type === "cat") {
        sec.insertAdjacentHTML("beforeend", `<table class="figs"><tbody>${STATES.map((s) => `<tr data-s="${s.fips}"><td>${s.name}</td><td class="num">${fmtVal(s.fips)}</td></tr>`).join("")}</tbody></table>`);
        sec.querySelectorAll("tr[data-s]").forEach((tr) => tr.addEventListener("click", () => focusState(tr.dataset.s)));
      } else {
        const order = STATES.slice().sort((a, b) => (val(b.fips) ?? -Infinity) - (val(a.fips) ?? -Infinity));
        bars(sec, order.map((s) => s.name), order.map((s) => val(s.fips)), null, m.fmt, null, "", (i) => focusState(order[i].fips));
      }
      sec.insertAdjacentHTML("beforeend", `<p class="hint2">Click a state's bar or the map to open it.</p>`);
      panel.insertAdjacentHTML("beforeend", foot);
      return;
    }

    const f = byId.get(id), s = GEO[id], p = f.properties, lvl = p.level;
    const stateName = SBY.get(p.state || id).name;
    const ref = lvl === "state" ? null : GEO[p.state];
    const refName = ref ? stateName : "";
    const popTxt = s ? `Population ${fInt(s.pop)}` : "";
    let note = popTxt;
    if (lvl === "state") note = `${popTxt} · ${fInt(countiesOf(id).length)} counties · ${fInt(SBY.get(id).tracts)} census tracts. Click a county to see its tracts.`;
    if (lvl === "county") {
      const n = tractFeats[p.state] ? tractFeats[p.state].filter((t) => t.properties.GEOID.startsWith(id)).length : null;
      note = `${popTxt}${n !== null ? ` · ${fInt(n)} census tracts` : ""}. Click a tract for its profile.`;
    }
    if (lvl === "tract" && s && s.pop < 500) note = `${popTxt}. Small population: estimates for this tract have wide margins of error.`;
    const refKey = ref ? `<span class="reflegend"><i></i>${refName}</span>` : "";

    panel.innerHTML = `<div class="ph"><nav class="crumbs" id="crumbs" aria-label="Location"></nav><h2>${p.name}</h2>${note ? `<div class="note">${note}</div>` : ""}</div>`;
    drawCrumbs();
    if (!s || !s.pop) { panel.insertAdjacentHTML("beforeend", `<p>No residents recorded in this area.</p>`); return; }

    // the current topic: every figure in a compact table, then its charts
    const sec = document.createElement("div");
    sec.className = "sec";
    sec.innerHTML = `<h3>${topic.label}${ref ? `<small>${refName}</small>` : ""}</h3>
      <table class="figs"><tbody>${topic.metrics.filter((m) => m.type !== "cat").map((m) => {
        const on = m.id === st.metric ? ' class="on"' : "";
        return `<tr${on} data-m="${m.id}"><td>${m.label}</td><td class="num">${fmtVal(id, m.id)}</td>${ref ? `<td class="num ref">${fmtVal(p.state, m.id, false)}</td>` : ""}</tr>`;
      }).join("")}</tbody></table>`;
    panel.appendChild(sec);
    sec.querySelectorAll("tr[data-m]").forEach((tr) => tr.addEventListener("click", () => setMetric(tr.dataset.m)));

    topic.charts.forEach((c) => {
      const cs = document.createElement("div");
      cs.className = "sec";
      cs.innerHTML = `<h3>${c.title}<small>${ref ? refKey : ""}</small></h3>${c.sub ? `<div class="csub">${c.sub}</div>` : ""}`;
      panel.appendChild(cs);
      drawChart(cs, c, s, ref, refName);
    });
    panel.insertAdjacentHTML("beforeend", foot);
  }

  // ---------- boot ----------
  drawSelect();
  new ResizeObserver(() => { if (st.view === "map") layout(); }).observe(mapbox);
  let panelW = 0, redraw = null;
  new ResizeObserver(([e]) => {
    const w = Math.round(e.contentRect.width);
    if (panelW && Math.abs(w - panelW) > 20) { clearTimeout(redraw); redraw = setTimeout(drawPanel, 150); }
    panelW = w;
  }).observe(panel);
  layout();
  const start = SBYID.get(decodeURIComponent(location.hash.slice(1)).toLowerCase());
  if (start) focusState(start.fips);
  else update(false);
})();
