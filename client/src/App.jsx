import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity, AlertTriangle, BarChart3, CheckCircle2, Database, Download,
  Gauge, HardDrive, History, Radio, Search, ShieldCheck, Thermometer, Wifi,
} from "lucide-react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Line, LineChart,
  ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis,
} from "recharts";

const API = import.meta.env.VITE_API_URL || "http://localhost:4000";
const THRESHOLD = 0.92;
const TABS = [
  ["live", "Live Telemetry", Radio],
  ["stability", "Hydraulic Stability & Phase-Plane Analysis", BarChart3],
  ["fleet", "24-Hour Buffer & Fleet Telemetry", HardDrive],
  ["diagnostic", "Accumulator Pre-Charge Diagnostic", Gauge],
  ["audit", "Audit Log & Plant Export", History],
  ["gateway", "Edge Gateway & Model Diagnostics", Database],
];
const format = (value, digits = 2) => Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : "--";
const istTime = (value = new Date()) => `${new Date(value).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour12: false })} IST`;
const istDateTime = (value = new Date()) => `${new Date(value).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" })} ${istTime(value)}`;
const panel = "rounded-xl border border-[#1e2130] bg-[#151a22]";

function Metric({ icon: Icon, label, value, detail, tone = "text-slate-100" }) {
  return <div className={`${panel} p-4`}><div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-slate-400"><Icon size={15} />{label}</div><div className={`mt-3 text-xl font-bold ${tone}`}>{value}</div><div className="mt-1 text-[11px] text-slate-500">{detail}</div></div>;
}

function ChartShell({ title, icon: Icon, children, unit }) {
  return <div className={`${panel} p-4`}><h3 className="mb-3 flex items-center gap-2 text-sm font-semibold"><Icon size={17} className="text-cyan-400" />{title}<span className="ml-auto text-[10px] font-normal text-slate-500">{unit}</span></h3><div className="h-56">{children}</div></div>;
}

function StatusBadge({ status }) {
  return <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${status === "AT RISK" ? "bg-rose-500/15 text-rose-400" : "bg-emerald-500/15 text-emerald-400"}`}>{status}</span>;
}

function AuditTable({ rows }) {
  return <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead className="border-b border-slate-700 text-[10px] uppercase tracking-wider text-slate-500"><tr><th className="px-3 py-2">Cycle</th><th className="px-3 py-2">IST timestamp</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">PS3_std</th><th className="px-3 py-2">Confidence</th></tr></thead><tbody>{rows.map((row) => <tr key={`${row.cycleNumber}-${row.timestamp}`} className="border-b border-slate-800/80"><td className="px-3 py-2 font-mono text-slate-300">#{row.cycleNumber}</td><td className="px-3 py-2 text-slate-400">{istDateTime(row.timestamp)}</td><td className="px-3 py-2"><StatusBadge status={row.status} /></td><td className="px-3 py-2 font-mono">{format(row.ps3Std, 4)} bar</td><td className="px-3 py-2 font-mono">{format(row.confidence, 1)}%</td></tr>)}</tbody></table></div>;
}

function Ring({ value }) {
  const percent = Math.min(100, Math.max(0, value));
  return <div className="relative grid h-44 w-44 place-items-center rounded-full" style={{ background: `conic-gradient(#10b981 ${percent * 3.6}deg, #263241 0deg)` }}><div className="grid h-32 w-32 place-items-center rounded-full bg-[#151a22]"><span className="text-2xl font-bold">{format(percent, 1)}%</span></div></div>;
}

function InfoRow({ label, value }) {
  return <div className="flex items-center justify-between gap-4 border-b border-slate-800 py-3 text-sm"><span className="text-slate-400">{label}</span><span className="text-right font-medium text-slate-100">{value}</span></div>;
}

export default function App() {
  const [latest, setLatest] = useState(null);
  const [series, setSeries] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [buffer, setBuffer] = useState({ active: 0, capacity: 1440 });
  const [connected, setConnected] = useState(false);
  const [tab, setTab] = useState("live");
  const [auditFilter, setAuditFilter] = useState("All Cycles");
  const [search, setSearch] = useState("");
  const [now, setNow] = useState(new Date());

  const refresh = useCallback(async () => {
    try {
      const responses = await Promise.all([
        fetch(`${API}/api/health`), fetch(`${API}/api/status/latest`),
        fetch(`${API}/api/status/timeseries?limit=60`), fetch(`${API}/api/status/alerts?limit=15`),
        fetch(`${API}/api/status/buffer-metrics`),
      ]);
      if (!responses.every((response) => response.ok)) throw new Error("API unavailable");
      setConnected((await responses[0].json()).connected);
      setLatest(await responses[1].json()); setSeries(await responses[2].json());
      setAlerts(await responses[3].json()); setBuffer(await responses[4].json());
    } catch { setConnected(false); }
  }, []);

  useEffect(() => { refresh(); const timer = setInterval(refresh, 2000); return () => clearInterval(timer); }, [refresh]);
  useEffect(() => { const timer = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(timer); }, []);

  const atRisk = latest?.status === "AT RISK";
  const stability = useMemo(() => {
    const ps3 = Number(latest?.ps3Std);
    if (!Number.isFinite(ps3)) return { label: "AWAITING TELEMETRY", tone: "text-slate-400" };
    if (ps3 > THRESHOLD) return { label: "CAVITATION / LINE BURST IMMINENT", tone: "text-rose-400" };
    if (ps3 >= 0.90) return { label: "TURBULENT (VIBRATION HAZARD)", tone: "text-amber-400" };
    return { label: "LAMINAR (STABLE)", tone: "text-emerald-400" };
  }, [latest]);
  const statistics = useMemo(() => {
    const values = series.map((row) => Number(row.ps3Std)).filter(Number.isFinite);
    if (!values.length) return { min: null, max: null, mean: null, rate: null };
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const first = Number(series[0]?.ps3Std); const last = Number(series.at(-1)?.ps3Std);
    return { min: Math.min(...values), max: Math.max(...values), mean, rate: Number.isFinite(first) && Number.isFinite(last) ? (last - first) / Math.max((series.length - 1) * 2 / 60, 1 / 60) : null };
  }, [series]);
  const availability = alerts.length ? alerts.filter((row) => row.status !== "AT RISK").length / alerts.length * 100 : 0;
  const utilization = buffer.capacity ? buffer.active / buffer.capacity * 100 : 0;
  const diagnostic = Number(latest?.ps3Delta) > 0 || atRisk
    ? { title: "IMMEDIATE SHUTDOWN REQUIRED", detail: "Risk of hydraulic line water hammer and bladder rupture.", tone: "border-rose-500/60 bg-rose-950/30 text-rose-300" }
    : Number(latest?.ps3Std) >= 0.90
      ? { title: "NITROGEN TOP-UP RECOMMENDED", detail: "Schedule intervention within 24 operational hours.", tone: "border-amber-500/60 bg-amber-950/20 text-amber-300" }
      : { title: "OPTIMAL PRE-CHARGE (>100 BAR)", detail: "No scheduled intervention needed.", tone: "border-emerald-500/60 bg-emerald-950/20 text-emerald-300" };
  const filteredAlerts = alerts.filter((row) => (auditFilter === "All Cycles" || row.status === (auditFilter === "Safe Operations" ? "SAFE" : "AT RISK")) && String(row.cycleNumber).includes(search));
  const sensorValue = (key, unit = "", digits = 1) => {
    const snakeKey = key.replace(/[A-Z]/g, (character) => `_${character.toLowerCase()}`);
    const value = latest?.[key] ?? latest?.[snakeKey];
    return Number.isFinite(Number(value)) ? `${format(value, digits)} ${unit}` : "--";
  };
  const exportCsv = () => {
    const rows = [["cycle_number", "ist_timestamp", "status", "ps3_std", "confidence", "failure_probability"], ...filteredAlerts.map((row) => [row.cycleNumber, istDateTime(row.timestamp), row.status, row.ps3Std, row.confidence, row.failureProbability])];
    const csv = rows.map((row) => row.map((value) => `"${String(value ?? "").replaceAll('"', '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = "press-01-shift-report.csv"; link.click(); URL.revokeObjectURL(url);
  };

  const liveView = <><section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Metric icon={Activity} label="Health State" value={latest?.status || "WAITING"} detail={`Cycle ${latest?.cycleNumber ?? "--"}`} tone={atRisk ? "text-rose-400" : "text-emerald-400"} /><Metric icon={Gauge} label="Model Confidence" value={`${format(latest?.confidence, 1)}%`} detail={`Failure probability ${format(latest?.failureProbability, 1)}%`} /><Metric icon={AlertTriangle} label="PS3_std precursor" value={`${format(latest?.ps3Std, 4)} bar`} detail={`${Number(latest?.ps3Delta ?? 0) >= 0 ? "+" : ""}${format(latest?.ps3Delta, 4)} bar vs 0.9200`} tone={atRisk ? "text-rose-400" : "text-amber-400"} /><Metric icon={Database} label="24-hour retention" value={`${buffer.active} / ${buffer.capacity}`} detail="Active cycles in rolling buffer" /></section><section className="mt-3 grid grid-cols-6 gap-2.5 lg:grid-cols-11">{[["PS1", "ps1_mean", "bar", 1], ["PS2", "ps2_mean", "bar", 1], ["PS3_STD", "ps3_std", "bar", 4], ["PS4", "ps4_mean", "bar", 1], ["PS5", "ps5_mean", "bar", 1], ["PS6", "ps6_mean", "bar", 1], ["TS2 COOLER", "ts2_mean", "°C", 1], ["TS1 RESERVOIR", "ts1_mean", "°C", 1], ["TS3 ACTUATOR", "ts3Mean", "°C", 1], ["TS4 VALVE BODY", "ts4Mean", "°C", 1], ["EPS1 MOTOR LOAD", "eps1Mean", "W", 1]].map(([label, key, unit, digits]) => <div key={label} className={`${panel} p-3`}><p className="text-[9px] uppercase tracking-wider text-slate-500">{label}</p><p className="mt-2 text-sm font-bold text-slate-200">{sensorValue(key, unit, digits)}</p></div>)}</section><section className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-3"><ChartShell title="PS3_std Rolling Instability" icon={Activity} unit="bar"><ResponsiveContainer><LineChart data={series}><CartesianGrid stroke="#27303b" strokeDasharray="3 3" /><XAxis dataKey="cycleNumber" stroke="#64748b" fontSize={10} /><YAxis stroke="#64748b" fontSize={10} /><Tooltip labelFormatter={(value) => `Cycle ${value}`} formatter={(value) => [`${format(value, 4)} bar`, "PS3_std"]} contentStyle={{ background: "#151a22", border: "1px solid #334155" }} /><ReferenceLine y={THRESHOLD} stroke="#ef4444" strokeDasharray="5 5" label="0.92 limit" /><Line type="monotone" dataKey="ps3Std" stroke="#22d3ee" strokeWidth={2} dot={false} /></LineChart></ResponsiveContainer></ChartShell><ChartShell title="TS2_mean Cooler Temperature" icon={Thermometer} unit="°C"><ResponsiveContainer><AreaChart data={series}><CartesianGrid stroke="#27303b" strokeDasharray="3 3" /><XAxis dataKey="cycleNumber" stroke="#64748b" fontSize={10} /><YAxis stroke="#64748b" fontSize={10} /><Tooltip labelFormatter={(value) => `Cycle ${value}`} formatter={(value) => [`${format(value, 2)} °C`, "TS2_mean"]} contentStyle={{ background: "#151a22", border: "1px solid #334155" }} /><ReferenceLine y={55} stroke="#f59e0b" strokeDasharray="5 5" label="55°C warning" /><Area type="monotone" dataKey="ts2Mean" stroke="#fb923c" fill="#fb923c" fillOpacity={0.15} /></AreaChart></ResponsiveContainer></ChartShell><ChartShell title="EPS1_mean Motor Power Load" icon={Activity} unit="W"><ResponsiveContainer><LineChart data={series}><CartesianGrid stroke="#27303b" strokeDasharray="3 3" /><XAxis dataKey="cycleNumber" stroke="#475569" fontSize={10} /><YAxis domain={["dataMin - 100", "dataMax + 100"]} stroke="#475569" fontSize={10} /><Tooltip labelFormatter={(value) => `Cycle ${value}`} formatter={(value) => [`${format(value, 1)} W`, "Motor Load"]} contentStyle={{ background: "#151a22", border: "1px solid #334155" }} /><Line type="monotone" dataKey="eps1Mean" stroke="#a855f7" strokeWidth={2} dot={false} /></LineChart></ResponsiveContainer></ChartShell></section><section className={`${panel} mt-3 p-4`}><h3 className="mb-3 flex items-center gap-2 text-sm font-semibold"><Wifi size={17} className="text-cyan-400" />15-Cycle Plant Audit</h3><AuditTable rows={alerts} /></section></>;

  const views = {
    live: liveView,
    stability: <><div className={`${panel} mb-3 flex flex-wrap items-center justify-between gap-3 p-4`}><div><p className="text-[10px] uppercase tracking-widest text-slate-500">Live stability index</p><p className={`mt-1 text-lg font-bold ${stability.tone}`}>{stability.label}</p></div><div className="text-right text-xs text-slate-400">Current PS3_std <span className="font-mono text-slate-100">{format(latest?.ps3Std, 4)} bar</span></div></div><section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[["Window Min", `${format(statistics.min, 4)} bar`], ["Window Max", `${format(statistics.max, 4)} bar`], ["Window Mean", `${format(statistics.mean, 4)} bar`], ["Trend Rate", `${statistics.rate >= 0 ? "+" : ""}${format(statistics.rate, 4)} Δ bar/min`]].map(([label, value]) => <Metric key={label} icon={Activity} label={label} value={value} detail="Loaded telemetry window" />)}</section><div className={`${panel} mt-3 p-4`}><h3 className="mb-3 text-sm font-semibold">Pressure instability vs cooler temperature phase-plane</h3><div className="h-72"><ResponsiveContainer><ScatterChart><CartesianGrid stroke="#27303b" /><XAxis type="number" dataKey="ps3Std" name="PS3_std" stroke="#64748b" fontSize={10} /><YAxis type="number" dataKey="ts2Mean" name="TS2_mean" stroke="#64748b" fontSize={10} /><Tooltip contentStyle={{ background: "#151a22", border: "1px solid #334155" }} /><ReferenceLine x={THRESHOLD} stroke="#ef4444" strokeDasharray="5 5" /><Scatter data={series} fill="#22d3ee" /></ScatterChart></ResponsiveContainer></div></div></>,
    fleet: <div className="grid gap-3 lg:grid-cols-2"><div className={`${panel} flex flex-col items-center p-7`}><h3 className="mb-5 text-sm font-semibold">Retained cycles / 1,440 daily capacity</h3><Ring value={utilization} /><p className="mt-4 text-xs text-slate-400">{buffer.active} active records in the current window</p></div><div className={`${panel} p-5`}><h3 className="mb-5 text-sm font-semibold">Fleet health distribution</h3><div className="h-40"><ResponsiveContainer><BarChart data={[{ name: "Current window", healthy: availability, critical: 100 - availability }]} layout="vertical"><XAxis type="number" domain={[0, 100]} stroke="#64748b" fontSize={10} unit="%" /><YAxis type="category" dataKey="name" hide /><Tooltip contentStyle={{ background: "#151a22", border: "1px solid #334155" }} /><Bar dataKey="healthy" stackId="a" fill="#10b981" /><Bar dataKey="critical" stackId="a" fill="#ef4444" /></BarChart></ResponsiveContainer></div><div className="flex justify-between text-xs"><span className="text-emerald-400">Healthy {format(availability, 1)}%</span><span className="text-rose-400">Critical {format(100 - availability, 1)}%</span></div><div className="mt-5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-300"><ShieldCheck size={16} className="mr-2 inline" />Sliding window retention active — Data older than 24 hours purged automatically to prevent PostgreSQL memory saturation.</div></div></div>,
    diagnostic: <div className="grid gap-3 lg:grid-cols-2"><div className={`${panel} p-5`}><h3 className="text-sm font-semibold">Nitrogen bladder health barometer</h3><p className="mt-2 text-xs text-slate-500">Estimated residual charge: {format(Math.max(0, 100 - Math.max(0, Number(latest?.ps3Delta) || 0) * 300), 1)} bar</p><div className="mt-7 h-8 overflow-hidden rounded-full bg-slate-800"><div className={`h-full ${atRisk ? "bg-rose-500" : "bg-emerald-500"}`} style={{ width: `${Math.min(100, Math.max(0, (100 - Math.max(0, Number(latest?.ps3Delta) || 0) * 300) / 140 * 100))}%` }} /></div><div className="mt-2 flex justify-between text-[10px] text-slate-500"><span>0 bar</span><span className="text-amber-400">Nominal 100</span><span className="text-rose-400">Hazard &lt;80</span><span>140 bar</span></div></div><div className={`${panel} p-5`}><h3 className="mb-2 text-sm font-semibold">Diagnostic checklist</h3>{["Seal integrity check", "Poppet valve seating", "High-frequency shock absorption rating"].map((item) => <div key={item} className="flex items-center gap-3 border-b border-slate-800 py-3 text-sm"><CheckCircle2 size={16} className={atRisk ? "text-amber-400" : "text-emerald-400"} />{item}<span className="ml-auto text-[10px] text-slate-500">{atRisk ? "VERIFY" : "NOMINAL"}</span></div>)}</div><div className={`rounded-xl border p-5 lg:col-span-2 ${diagnostic.tone}`}><p className="text-[10px] font-bold uppercase tracking-widest">Prescriptive action</p><h4 className="mt-3 text-xl font-bold">{diagnostic.title}</h4><p className="mt-2 text-sm">{diagnostic.detail}</p></div></div>,
    audit: <div className={`${panel} p-4`}><div className="mb-4 flex flex-wrap items-center gap-2"><div className="flex rounded-lg bg-slate-900 p-1">{["All Cycles", "Safe Operations", "Risk Events Only"].map((filter) => <button key={filter} onClick={() => setAuditFilter(filter)} className={`rounded-md px-3 py-2 text-[10px] font-semibold transition ${auditFilter === filter ? "bg-cyan-500/20 text-cyan-300" : "text-slate-500 hover:text-slate-200"}`}>{filter}</button>)}</div><label className="flex flex-1 items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-400 sm:max-w-xs"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search cycle number" className="w-full bg-transparent outline-none placeholder:text-slate-600" /></label><button onClick={exportCsv} className="flex items-center gap-2 rounded-lg bg-cyan-500 px-3 py-2 text-[10px] font-bold text-slate-950 hover:bg-cyan-300"><Download size={14} />Download Shift Report (CSV)</button></div><AuditTable rows={filteredAlerts} /></div>,
    gateway: <div className="grid gap-3 lg:grid-cols-2"><div className={`${panel} p-5`}><h3 className="mb-2 text-sm font-semibold">Edge architecture summary</h3><InfoRow label="ML Model" value="Random Forest (200 Estimators, Gini Impurity, 97.05% Accuracy)" /><InfoRow label="Ingestion Cycle" value="60-second duty cycle downsampled every 2s" /><InfoRow label="Feature Vector" value="33 statistical attributes (feature_columns.json)" /></div><div className={`${panel} p-5`}><h3 className="mb-2 text-sm font-semibold">Runtime diagnostics</h3><InfoRow label="Inference Latency" value="< 8.4 ms (Local CPU Edge Execution)" /><InfoRow label="Database" value="PostgreSQL 16 on Localhost Port 5432" /><InfoRow label="Gateway Link" value={connected ? "Online / streaming" : "Offline"} /></div></div>,
  };

  return <main className="min-h-screen bg-[#0e1117] px-3 py-4 text-slate-200 sm:px-6 lg:px-8"><header className="mx-auto max-w-[1500px] border-b border-slate-800 pb-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-cyan-400">PATIL INDUSTRIES</p><h1 className="mt-1 text-lg font-bold">Edge Predictive Maintenance Control Room</h1></div><div className="flex flex-wrap items-center gap-3 text-xs text-slate-300"><span className="flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${connected ? "bg-emerald-400" : "bg-rose-400"}`} />PostgreSQL {connected ? "LIVE" : "OFFLINE"}</span><span className="font-mono">PRESS_01</span><span className="font-mono text-slate-400">IST {now.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour12: false })} | {now.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" })}</span></div></div><div className="mt-3 grid gap-2 rounded-lg border border-[#1e2130] bg-[#11161e] p-3 text-[10px] text-slate-400 sm:grid-cols-2 lg:grid-cols-4"><span><b className="text-slate-200">Plant Unit:</b> Patil Industries Foundry Division, Plant-1</span><span><b className="text-slate-200">Asset:</b> 500-Ton Hydraulic Extrusion Press (ID: PRESS_01)</span><span><b className="text-slate-200">Gateway:</b> Edge Industrial PC (Local Loop)</span><span><b className="text-slate-200">Active Stream:</b> PostgreSQL Port 5432 (Sub-10ms Polling)</span></div></header><nav className="mx-auto mt-3 flex max-w-[1500px] gap-1 overflow-x-auto border-b border-slate-800 pb-2">{TABS.map(([id, label, Icon]) => <button key={id} onClick={() => setTab(id)} className={`flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-[10px] font-semibold transition-all ${tab === id ? "bg-cyan-500/15 text-cyan-300 shadow-[inset_0_-2px_0_#22d3ee]" : "text-slate-500 hover:bg-slate-800/70 hover:text-slate-200"}`}><Icon size={14} />{label}</button>)}</nav><section className={`mx-auto mt-3 max-w-[1500px] rounded-xl border p-4 transition-colors ${atRisk ? "border-rose-500/60 bg-rose-950/40" : "border-emerald-500/50 bg-emerald-950/30"}`}><div className="flex items-center gap-3"><div className={`rounded-full p-2 ${atRisk ? "bg-rose-500/20 text-rose-400" : "bg-emerald-500/20 text-emerald-400"}`}>{atRisk ? <AlertTriangle size={20} /> : <CheckCircle2 size={20} />}</div><div><p className={`text-[10px] font-bold uppercase tracking-[0.25em] ${atRisk ? "text-rose-300" : "text-emerald-300"}`}>{atRisk ? "CRITICAL: AT RISK" : "SAFE"}</p><h2 className="mt-1 text-base font-bold">{atRisk ? "Accumulator Degradation / Line Burst Hazard" : "Optimal Nitrogen Pressure"}</h2></div></div></section><section className="mx-auto mt-3 max-w-[1500px]">{views[tab]}</section></main>;
}
