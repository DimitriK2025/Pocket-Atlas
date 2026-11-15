/* Atlas front end. Expects window.ATLAS_DATA (built by scripts/bundle.py), d3 and topojson.
   Topics, metrics and charts are all described in ATLAS_DATA.meta (see scripts/process_acs.py). */
(function () {
  "use strict";
  const D = window.ATLAS_DATA;
  const STATE_ID = Object.keys(D.geo).find((k) => k.length === 2);
  const S0 = D.geo[STATE_ID];
  const RACE = D.meta.race;

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
    if (s) s.m.density = f.properties.aland > 0 ? s.pop / (f.properties.aland / SQMI) : null;
  });
  S0.m.density = S0.pop / (landTotal / SQMI);

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
  const TOPICS = D.meta.topics;
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
  const st = { topic: "overview", metric: "median_income", level: "county", focus: null, selected: STATE_ID, view: "map", sort: { key: "value", dir: -1 } };

  // ---------- DOM ----------
  const $ = (s) => document.querySelector(s);
  const topicsEl = $("#topics"), metricsEl = $("#metrics"), crumbsEl = $("#crumbs");
  const mainEl = $("#main"), ovEl = $("#overview");
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
  let geoPath, W = 0, H = 0;
  const zoom = d3.zoom().scaleExtent([1, 60]).on("zoom", (e) => gZoom.attr("transform", e.transform));
  svg.call(zoom).on("dblclick.zoom", null);

  const countySel = gCounty.selectAll("path").data(counties).join("path").attr("class", "unit");
  const tractSel = gTract.selectAll("path").data(tracts).join("path").attr("class", "unit");

  function layout() {
    const r = mapbox.getBoundingClientRect();
    W = Math.max(r.width, 200); H = Math.max(r.height, 200);
    svg.attr("viewBox", [0, 0, W, H]);
    const c = d3.geoCentroid(stateFeat);
    const projection = d3.geoConicConformal().rotate([-c[0], 0]).parallels([c[1] - 2, c[1] + 2])
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
  const has = (v) => v !== null && v !== undefined && !Number.isNaN(v);
  const val = (id, mId) => { const s = D.geo[id]; return s ? s.m[mId || st.metric] : null; };
  function refUnits() { return st.level === "county" && !st.focus ? counties : tracts; }
  function visibleUnits() {
    if (st.level === "county" && !st.focus) return counties;
    if (st.focus) return tracts.filter((f) => f.properties.GEOID.startsWith(st.focus));
    return tracts;
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
    const tractMode = st.level === "tract" || st.focus;
    countySel.attr("fill", fillOf).classed("dim", !!st.focus).style("display", tractMode && !st.focus ? "none" : null);
    tractSel.attr("fill", fillOf).style("display", (f) => {
      if (!tractMode) return "none";
      return st.focus && !f.properties.GEOID.startsWith(st.focus) ? "none" : null;
    });
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
    const how = m.type === "cat" ? "" : m.type === "div" ? " · fixed breaks" : " · 7 equal-count groups of " + where;
    let h = `<div class="ltitle"><b>${m.label}</b>${m.unit}${how}</div>`;
    if (scale.type === "cat") {
      h += `<div class="catlegend">${scale.present.map((i) => `<span><i style="background:${CAT[i]}"></i>${RACE[i]}</span>`).join("")}</div>`;
    } else {
      const n = scale.colors.length, w = 46, gap = 2, tick = FMT[m.fmt].t;
      h += `<div class="scale"><div class="swatches">${scale.colors.map((c) => `<i style="background:${c}"></i>`).join("")}</div>
        <div class="ticks" style="width:${n * w + (n - 1) * gap}px">${scale.th.map((t, i) => `<span style="left:${(i + 1) * (w + gap) - gap / 2}px">${tick(t)}</span>`).join("")}</div></div>`;
    }
    h += `<span class="nd"><i></i>No data / too few residents</span>`;
    legendEl.innerHTML = h;
    const sw = legendEl.querySelector(".swatches i");
    if (sw && sw.offsetWidth && sw.offsetWidth !== 46) {
      const w = sw.offsetWidth, gap = 2;
      legendEl.querySelector(".ticks").style.width = scale.colors.length * (w + gap) + "px";
      legendEl.querySelectorAll(".ticks span").forEach((s, i) => (s.style.left = (i + 1) * (w + gap) - gap / 2 + "px"));
    }
  }

  // ---------- value formatting with margin of error ----------
  function fmtVal(id, mId, withMoe = true) {
    const m = METRIC[mId || st.metric], s = D.geo[id];
    if (!s) return "No data";
    const v = s.m[m.id];
    if (!has(v)) return "No data";
    let out = FMT[m.fmt].f(v);
    if (withMoe && m.moe && s.moe && has(s.moe[m.id])) out += ` <span class="tc">±${FMT[m.fmt].f(s.moe[m.id])}</span>`;
    return out;
  }

  // ---------- tooltip ----------
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

  function focusCounty(id) { st.focus = id; st.selected = id; update(true); }
  function select(id) {
    st.selected = id;
    if (id.length === 11 && st.focus && !id.startsWith(st.focus)) st.focus = null;
    update(false);
  }
  function goState() { st.focus = null; st.selected = STATE_ID; update(true); }
  function update(rezoom) {
    const ov = st.topic === "overview";
    const wasHidden = mainEl.hidden;
    mainEl.hidden = ov; ovEl.hidden = !ov; metricsEl.hidden = ov;
    syncControls();
    if (ov) { drawOverview(); return; }
    if (wasHidden && st.view === "map") layout();
    paint(); drawSelection(); drawCrumbs(); drawPanel();
    if (rezoom && !wasHidden) zoomToCurrent(true);
  }
  function goTopic(tid, mid, county) {
    const t = TOPICS.find((x) => x.id === tid);
    st.topic = tid; st.metric = mid || t.metrics[0].id;
    if (county) { st.level = "county"; st.focus = county; st.selected = county; }
    drawMetrics(); update(false);
    window.scrollTo(0, 0);
  }
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || st.topic === "overview") return;
    if (st.selected.length === 11 && st.focus) select(st.focus);
    else if (st.focus || st.selected !== STATE_ID) goState();
  });

  function drawCrumbs() {
    const parts = [{ id: STATE_ID, label: D.name }];
    const sel = st.selected;
    const cid = st.focus || (sel.length >= 5 ? sel.slice(0, 5) : null);
    if (cid) parts.push({ id: cid, label: byId.get(cid).properties.name });
    if (sel.length === 11) parts.push({ id: sel, label: byId.get(sel).properties.name });
    crumbsEl.innerHTML = parts.map((p, i) => i === parts.length - 1
      ? `<span class="here">${p.label}</span>`
      : `<button data-id="${p.id}">${p.label}</button><span class="sep">›</span>`).join("");
    crumbsEl.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
      if (b.dataset.id === STATE_ID) goState(); else focusCounty(b.dataset.id);
    }));
  }

  // ---------- controls ----------
  function drawTopics() {
    topicsEl.innerHTML = [{ id: "overview", label: "Overview" }, ...TOPICS]
      .map((t) => `<button class="topic" role="tab" id="topic-${t.id}" data-t="${t.id}">${t.label}</button>`).join("");
    topicsEl.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
      if (b.dataset.t === "overview") { st.topic = "overview"; update(false); }
      else goTopic(b.dataset.t);
    }));
  }
  function drawMetrics() {
    const t = TOPICS.find((x) => x.id === st.topic);
    if (!t) { metricsEl.innerHTML = ""; return; }
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
  const toShares = (arr, total) => {
    const t = total || d3.sum(arr, (v) => v || 0);
    return arr.map((v) => (t && has(v) ? (100 * v) / t : null));
  };

  // Bars with the label above each bar (labels can be long); optional state reference tick.
  function bars(el, labels, values, refs, fmt, counts) {
    const F = FMT[fmt].f;
    const max = Math.max(d3.max(values, (v) => v || 0), refs ? d3.max(refs, (v) => v || 0) : 0) || 1;
    const w = 340, rowH = 30, bh = 9;
    const x = d3.scaleLinear([0, max], [0, w]);
    const data = labels.map((l, i) => ({ l, v: values[i], r: refs ? refs[i] : null, c: counts ? counts[i] : null }));
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
    chartTip(g, (d) => `<div class="tn">${d.l}</div><div class="tv"><span>Value</span><b>${has(d.v) ? F(d.v) : "–"}</b></div>
      ${has(d.c) ? `<div class="tv"><span>Count</span><b>${fInt(d.c)}</b></div>` : ""}
      ${has(d.r) ? `<div class="tv"><span>${D.name}</span><b>${F(d.r)}</b></div>` : ""}`);
  }

  function columns(el, labels, values, refs, counts) {
    const max = Math.max(d3.max(values, (v) => v || 0), refs ? d3.max(refs, (v) => v || 0) : 0) || 1;
    const w = 340, h = 120, bottom = 18, n = labels.length, gap = 2;
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
      ${has(d.r) ? `<div class="tv"><span>${D.name}</span><b>${d.r.toFixed(1)}%</b></div>` : ""}`);
  }

  function pyramid(el, counts, refCounts, labels) {
    const n = labels.length;
    const tot = d3.sum(counts) || 1, rtot = refCounts ? d3.sum(refCounts) : 1;
    const bins = labels.map((b, i) => ({ b, m: (100 * counts[i]) / tot, f: (100 * counts[i + n]) / tot, cm: counts[i], cf: counts[i + n],
      rm: refCounts ? (100 * refCounts[i]) / rtot : null, rf: refCounts ? (100 * refCounts[i + n]) / rtot : null })).reverse();
    const max = d3.max(bins, (d) => Math.max(d.m, d.f, d.rm || 0, d.rf || 0)) || 1;
    const w = 340, mid = 170, lab = 22, rowH = 13, bh = 11;
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

  function drawChart(sec, c, s, ref) {
    const cur = s.d[c.id], rd = ref ? ref.d[c.id] : null;
    if (!cur || cur.every((v) => !has(v) || v === 0)) { sec.insertAdjacentHTML("beforeend", `<p class="empty">No data for this place.</p>`); return; }
    if (c.kind === "pyramid") {
      sec.insertAdjacentHTML("beforeend", `<div class="pyrkey"><span><i style="background:var(--series-1)"></i>Men</span><span><i style="background:var(--series-2)"></i>Women</span></div>`);
      pyramid(sec, cur, rd, c.labels);
    } else if (c.kind === "values") {
      bars(sec, c.labels, cur, rd, c.fmt);
    } else if (c.kind === "hist") {
      columns(sec, c.labels, toShares(cur), rd && toShares(rd), cur);
    } else {
      const t = c.of_total ? (s.t || {})[c.id] : null, rt = c.of_total && ref ? (ref.t || {})[c.id] : null;
      bars(sec, c.labels, toShares(cur, t), rd && toShares(rd, rt), "pct", cur);
    }
  }

  function drawPanel() {
    const id = st.selected, f = byId.get(id), s = D.geo[id];
    const lvl = f.properties.level;
    const topic = TOPICS.find((t) => t.id === st.topic);
    const eyebrow = lvl === "state" ? "State" : lvl === "county" ? "County" : "Census tract · " + f.properties.county;
    const ref = id === STATE_ID ? null : S0;
    const popTxt = s ? `Population ${fInt(s.pop)}` : "";
    let note = popTxt;
    if (lvl === "state") note = `${popTxt} · ${counties.length} counties · ${fInt(tracts.length)} census tracts. Click a county to see its tracts.`;
    if (lvl === "county") note = `${popTxt} · ${tracts.filter((t) => t.properties.GEOID.startsWith(id)).length} census tracts. Click one for its profile.`;
    if (lvl === "tract" && s && s.pop < 500) note = `${popTxt}. Small population: estimates for this tract have wide margins of error.`;
    const refKey = ref ? `<span class="reflegend"><i></i>${D.name}</span>` : "";

    panel.innerHTML = `<div class="ph"><div class="eyebrow">${eyebrow}</div><h2>${f.properties.name}</h2>${note ? `<div class="note">${note}</div>` : ""}</div>`;
    if (!s || !s.pop) { panel.insertAdjacentHTML("beforeend", `<p>No residents recorded in this area.</p>`); return; }

    // the current topic: every figure in a compact table, then its charts
    const sec = document.createElement("div");
    sec.className = "sec";
    sec.innerHTML = `<h3>${topic.label}${ref ? `<small>${D.name}</small>` : ""}</h3>
      <table class="figs"><tbody>${topic.metrics.filter((m) => m.type !== "cat").map((m) => {
        const on = m.id === st.metric ? ' class="on"' : "";
        return `<tr${on} data-m="${m.id}"><td>${m.label}</td><td class="num">${fmtVal(id, m.id)}</td>${ref ? `<td class="num ref">${fmtVal(STATE_ID, m.id, false)}</td>` : ""}</tr>`;
      }).join("")}</tbody></table>`;
    panel.appendChild(sec);
    sec.querySelectorAll("tr[data-m]").forEach((tr) => tr.addEventListener("click", () => { st.metric = tr.dataset.m; update(false); }));

    topic.charts.forEach((c) => {
      const cs = document.createElement("div");
      cs.className = "sec";
      cs.innerHTML = `<h3>${c.title}<small>${ref ? refKey : c.sub}</small></h3>${ref && c.sub ? `<div class="csub">${c.sub}</div>` : ""}`;
      panel.appendChild(cs);
      drawChart(cs, c, s, ref);
    });

    panel.insertAdjacentHTML("beforeend", `<div class="foot">Source: U.S. Census Bureau, American Community Survey 2019–2023 5-year estimates.
      ± values are 90% margins of error. Census tracts average about 4,000 residents, so small differences between tracts are often within the margin of error.</div>`);
  }

  // ---------- overview (no map) ----------
  const GLANCE = ["median_age", "median_income", "pct_ba_plus", "poverty", "pct_owner", "median_value", "pct_foreign_born", "mean_commute"];
  const EXTREMES = ["median_income", "poverty", "pct_ba_plus", "median_age", "median_value", "pct_foreign_born", "pct_owner", "pct_seasonal"];
  function drawOverview() {
    const F = (id, v) => FMT[METRIC[id].fmt].f(v);
    const tile = (label, value, unit) => `<div class="kpi"><span class="k">${label}</span><span class="v">${value}</span><span class="c">${unit}</span></div>`;
    const tiles = [tile("Population", fInt(S0.pop), fDens(S0.m.density) + " people per square mile")]
      .concat(GLANCE.map((id) => tile(METRIC[id].label, has(S0.m[id]) ? F(id, S0.m[id]) : "–", METRIC[id].unit)));
    const cty = (d, id) => `<button class="lnk" data-topic="${METRIC[id].topic}" data-m="${id}" data-county="${d.f.properties.GEOID}">${d.f.properties.name.replace(/ County$/, "")}</button><span class="ev">${F(id, d.v)}</span>`;
    const ext = EXTREMES.map((id) => {
      const vals = counties.map((f) => ({ f, v: val(f.properties.GEOID, id) })).filter((d) => has(d.v)).sort((a, b) => b.v - a.v);
      return `<tr><td><button class="lnk strong" data-topic="${METRIC[id].topic}" data-m="${id}">${METRIC[id].label}</button></td>
        <td>${cty(vals[0], id)}</td><td>${cty(vals[vals.length - 1], id)}</td></tr>`;
    }).join("");
    const cards = TOPICS.map((t) => {
      const names = t.metrics.filter((m) => !["pop", "density"].includes(m.id)).map((m) => m.label);
      return `<button class="tcard" data-topic="${t.id}"><b>${t.label}</b><span>${names.slice(0, 4).join(" · ")}${names.length > 4 ? " · and more" : ""}</span></button>`;
    }).join("");
    ovEl.innerHTML = `
      <div class="ov-lead">
        <p class="standfirst">Who lives in ${D.name}, mapped from the whole state down to its ${fInt(tracts.length)} census tracts:
          ${TOPICS.length} topics and ${Object.keys(METRIC).length} statistics from the U.S. Census Bureau's American Community Survey.</p>
      </div>
      <div class="ov-grid">
        <section class="ov-sec ov-glance"><h2>${D.name} at a glance</h2><div class="kpis four">${tiles.join("")}</div></section>
        <section class="ov-sec ov-ext"><h2>Highs and lows by county</h2>
          <table class="ext"><thead><tr><th>Statistic</th><th>Highest</th><th>Lowest</th></tr></thead><tbody>${ext}</tbody></table>
          <p class="hint2">Click a statistic to map it, or a county to open its tracts.</p></section>
        <section class="ov-sec ov-topics"><h2>What's in the atlas</h2><div class="tcards">${cards}</div></section>
        <section class="ov-sec ov-about"><h2>How it works</h2><ul>
          <li><b>Pick a topic</b> above, then a statistic. Counties are colored first; click one to zoom into its census tracts, then click a tract for its full profile.</li>
          <li><b>Census tracts</b> are small neighborhoods of roughly 1,200 to 8,000 people, drawn by the Census Bureau to stay stable over time.</li>
          <li><b>Colors</b> split places into 7 groups with equal numbers of places in each, from white (lowest) to deep blue (highest).</li>
          <li><b>Data</b> are American Community Survey 2019–2023 five-year estimates, the most recent release that covers every tract.
            They are survey estimates: ± figures are 90% margins of error, and small tracts carry wide ones.</li>
          <li><b>Left out:</b> fertility. Tract-level birth counts are too small for the survey to measure reliably.</li>
        </ul></section>
      </div>`;
    ovEl.querySelectorAll("[data-topic]").forEach((b) => b.addEventListener("click", () => goTopic(b.dataset.topic, b.dataset.m, b.dataset.county)));
  }

  // ---------- boot ----------
  drawTopics(); drawMetrics();
  new ResizeObserver(() => { if (st.view === "map" && !mainEl.hidden) layout(); }).observe(mapbox);
  layout(); update(false);
})();
